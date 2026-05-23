import { Readable } from 'node:stream';
import type { TtsProviderContext, TtsRuntimeConfig } from '@tts-conductor/core';
import {
  TtsAuthenticationError,
  TtsError,
  TtsInvalidInputError,
  TtsQuotaExceededError,
  TtsRateLimitError,
  TtsTransientError,
} from '@tts-conductor/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Minimal stand-ins for the ElevenLabs SDK error classes, so the adapter's
// `instanceof ElevenLabsError` / `instanceof ElevenLabsTimeoutError` checks
// work against test-injected errors. Mirrors the SDK's `rawResponse.headers`
// shape so the retry-after extractor has something to read.
class FakeElevenLabsError extends Error {
  readonly statusCode?: number;
  readonly body?: unknown;
  readonly rawResponse?: { headers?: Record<string, string> };

  constructor(opts: {
    message?: string;
    statusCode?: number;
    body?: unknown;
    rawResponse?: { headers?: Record<string, string> };
  }) {
    super(opts.message ?? 'fake');
    // Mirror the real SDK's defensive Object.setPrototypeOf for instanceof
    // safety under transpiled targets. Not strictly required here (we target
    // ES2021), but keeps the fake faithful to the production class shape.
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'ElevenLabsError';
    this.statusCode = opts.statusCode;
    this.body = opts.body;
    this.rawResponse = opts.rawResponse;
  }
}

class FakeElevenLabsTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'ElevenLabsTimeoutError';
  }
}

const convertHandler = vi.hoisted(() => vi.fn());
const ElevenLabsClientMock = vi.hoisted(() =>
  // biome-ignore lint/complexity/useArrowFunction: needs to be a regular function so the mock is constructable under Vitest 4 — arrow functions cannot be invoked with `new`.
  vi.fn(function () {
    return {
      textToSpeech: {
        convert: convertHandler,
      },
    };
  }),
);

vi.mock('@elevenlabs/elevenlabs-js', () => ({
  ElevenLabsClient: ElevenLabsClientMock,
  ElevenLabsError: FakeElevenLabsError,
  ElevenLabsTimeoutError: FakeElevenLabsTimeoutError,
}));

const getAudioDurationMock = vi.hoisted(() => vi.fn().mockResolvedValue(1.5));

vi.mock('@tts-conductor/core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@tts-conductor/core');
  return {
    ...actual,
    getAudioDuration: getAudioDurationMock,
  };
});

let elevenLabsProviderFactory: typeof import('../elevenLabsProvider')['elevenLabsProviderFactory'];

function createContext(overrides: Partial<TtsRuntimeConfig> = {}): {
  context: TtsProviderContext;
  logger: NonNullable<TtsRuntimeConfig['logger']>;
} {
  const logger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  } satisfies NonNullable<TtsRuntimeConfig['logger']>;

  const config: TtsRuntimeConfig = {
    pauses: overrides.pauses ?? {},
    logger: overrides.logger ?? logger,
    debug: overrides.debug,
    ffmpeg: overrides.ffmpeg,
  };

  return {
    context: { config, id: '11labs' },
    logger: config.logger!,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  convertHandler.mockReset();
  ElevenLabsClientMock.mockReset();
  getAudioDurationMock.mockResolvedValue(1.5);
  ({ elevenLabsProviderFactory } = await import('../elevenLabsProvider'));
});

describe('ElevenLabsProvider', () => {
  it('generates audio using a Node stream', async () => {
    const { context } = createContext();
    convertHandler.mockResolvedValue(Readable.from([Buffer.from('hello')])).mockName('convert');

    const provider = elevenLabsProviderFactory.create(context, {
      apiKey: 'key',
      voiceId: 'voice',
    });

    const result = await provider.generate('<speak>Hello</speak>');

    expect(ElevenLabsClientMock).toHaveBeenCalledWith({ apiKey: 'key' });
    expect(convertHandler).toHaveBeenCalledWith(
      'voice',
      expect.objectContaining({
        text: '<speak>Hello</speak>',
        modelId: 'eleven_multilingual_v2',
        outputFormat: 'mp3_44100_128',
      }),
      expect.anything(),
    );
    const [bufferArg] = getAudioDurationMock.mock.calls[0] ?? [];
    expect(Buffer.isBuffer(bufferArg)).toBe(true);
    expect(bufferArg?.toString()).toBe('hello');
    expect(result.duration).toBe(1.5);
    expect(result.size).toBeGreaterThan(0);
  });

  describe('AbortSignal (A3)', () => {
    it('forwards the signal to the ElevenLabs SDK as abortSignal', async () => {
      const { context } = createContext();
      convertHandler.mockResolvedValue(Readable.from([Buffer.from('x')])).mockName('convert');
      const controller = new AbortController();

      const provider = elevenLabsProviderFactory.create(context, {
        apiKey: 'key',
        voiceId: 'voice',
      });

      await provider.generate('<speak>x</speak>', { signal: controller.signal });

      // The SDK's convert(voice_id, request, requestOptions) takes the signal
      // on the third argument as `abortSignal`.
      expect(convertHandler).toHaveBeenCalledWith(
        'voice',
        expect.anything(),
        expect.objectContaining({ abortSignal: controller.signal }),
      );
    });

    it('throws AbortError immediately when the signal is already aborted', async () => {
      const { context } = createContext();
      const controller = new AbortController();
      controller.abort();

      const provider = elevenLabsProviderFactory.create(context, {
        apiKey: 'key',
        voiceId: 'voice',
      });

      // Assert the error TYPE — a regression that wraps abort into TtsError
      // (the very bug the post-review fix addressed) would silently pass a
      // bare `.rejects.toThrow()` check.
      await expect(
        provider.generate('<speak>x</speak>', { signal: controller.signal }),
      ).rejects.toMatchObject({ name: 'AbortError' });

      // No upstream call should have happened.
      expect(convertHandler).not.toHaveBeenCalled();
    });

    it('propagates a mid-flight AbortError instead of wrapping it in TtsError', async () => {
      const { context } = createContext();
      const abortErr = new Error('aborted');
      abortErr.name = 'AbortError';
      // Simulate the SDK throwing an AbortError after the convert call started
      // (this is what happens when signal.abort() fires while textToSpeech.convert
      // is in flight). The catch block must NOT wrap this in TtsError.
      convertHandler.mockRejectedValue(abortErr);
      const controller = new AbortController();
      controller.abort();

      const provider = elevenLabsProviderFactory.create(context, {
        apiKey: 'key',
        voiceId: 'voice',
      });

      // The signal was aborted, so even though convertHandler resolved with
      // an AbortError that arrived inside the try block, the catch should
      // recognize the aborted signal and propagate the original error.
      // We expect this NOT to be a TtsError-wrapped failure.
      await expect(
        provider.generate('<speak>x</speak>', { signal: controller.signal }),
      ).rejects.toMatchObject({ name: 'AbortError' });
    });
  });

  describe('per-call overrides (A2)', () => {
    it('overrides voiceId at call time without rebuilding the provider', async () => {
      const { context } = createContext();
      convertHandler.mockResolvedValue(Readable.from([Buffer.from('x')])).mockName('convert');

      const provider = elevenLabsProviderFactory.create(context, {
        apiKey: 'key',
        voiceId: 'default-voice',
      });

      await provider.generate('<speak>x</speak>', { overrides: { voiceId: 'override-voice' } });

      // convertHandler is called with (voiceId, request). The first arg should be the override.
      expect(convertHandler.mock.calls[0]?.[0]).toBe('override-voice');
    });

    it('overrides voiceSettings at call time (full replacement, not shallow merge)', async () => {
      const { context } = createContext();
      convertHandler.mockResolvedValue(Readable.from([Buffer.from('x')])).mockName('convert');
      const overrideSettings = { stability: 0.9, similarity_boost: 0.4 } as const;

      const provider = elevenLabsProviderFactory.create(context, {
        apiKey: 'key',
        voiceId: 'voice',
        // Construction-time has stability AND speed.
        voiceSettings: { stability: 0.1, speed: 0.7 },
      });

      // Override supplies only stability + similarity_boost. The full-replacement
      // semantic means `speed: 0.7` from construction time should be dropped —
      // it's not shallow-merged.
      await provider.generate('<speak>x</speak>', {
        overrides: { voiceSettings: overrideSettings },
      });

      const callArgs = convertHandler.mock.calls[0]?.[1] as { voiceSettings: object };
      expect(callArgs.voiceSettings).toEqual(overrideSettings);
      // Explicitly verify the construction-time `speed` did NOT leak through —
      // this would silently flip to true under a shallow-merge implementation.
      expect(callArgs.voiceSettings).not.toHaveProperty('speed');
    });

    it('falls back to construction-time voiceId when only voiceSettings is overridden', async () => {
      const { context } = createContext();
      convertHandler.mockResolvedValue(Readable.from([Buffer.from('x')])).mockName('convert');

      const provider = elevenLabsProviderFactory.create(context, {
        apiKey: 'key',
        voiceId: 'base-voice',
        quality: 'standard',
      });

      // Override only voiceSettings — voiceId and quality should fall back.
      await provider.generate('<speak>x</speak>', {
        overrides: { voiceSettings: { stability: 0.5 } },
      });

      // Symmetry check: confirms the three ?? fallback chains aren't
      // interdependent — fallback works in any direction.
      expect(convertHandler.mock.calls[0]?.[0]).toBe('base-voice');
      expect(convertHandler).toHaveBeenCalledWith(
        'base-voice',
        expect.objectContaining({ modelId: 'eleven_multilingual_v2' }),
        expect.anything(),
      );
    });

    it('overrides quality (model mapping) at call time', async () => {
      const { context } = createContext();
      convertHandler.mockResolvedValue(Readable.from([Buffer.from('x')])).mockName('convert');

      const provider = elevenLabsProviderFactory.create(context, {
        apiKey: 'key',
        voiceId: 'voice',
        quality: 'standard',
      });

      await provider.generate('<speak>x</speak>', { overrides: { quality: 'draft' } });

      expect(convertHandler).toHaveBeenCalledWith(
        'voice',
        expect.objectContaining({ modelId: 'eleven_turbo_v2_5' }),
        expect.anything(),
      );
    });

    it('falls back to construction-time options for fields not overridden', async () => {
      const { context } = createContext();
      convertHandler.mockResolvedValue(Readable.from([Buffer.from('x')])).mockName('convert');
      const baseSettings = { stability: 0.5, speed: 0.9 } as const;

      const provider = elevenLabsProviderFactory.create(context, {
        apiKey: 'key',
        voiceId: 'base-voice',
        voiceSettings: baseSettings,
        quality: 'high',
      });

      // Override only voiceId; voiceSettings and quality should fall back to construction-time.
      await provider.generate('<speak>x</speak>', { overrides: { voiceId: 'just-voice-changed' } });

      expect(convertHandler.mock.calls[0]?.[0]).toBe('just-voice-changed');
      expect(convertHandler).toHaveBeenCalledWith(
        'just-voice-changed',
        expect.objectContaining({
          voiceSettings: baseSettings,
          modelId: 'eleven_multilingual_v2', // 'high' quality
        }),
        expect.anything(),
      );
    });
  });

  it('passes voice settings and quality mapping to ElevenLabs', async () => {
    const { context } = createContext();
    convertHandler.mockResolvedValue(Readable.from([Buffer.from('data')])).mockName('convert');
    const voiceSettings = { stability: 0.5, speed: 0.9 } as const;

    const provider = elevenLabsProviderFactory.create(context, {
      apiKey: 'key',
      voiceId: 'voice',
      voiceSettings,
      quality: 'draft',
    });

    await provider.generate('<speak>Draft</speak>');

    expect(convertHandler).toHaveBeenCalledWith(
      'voice',
      expect.objectContaining({
        voiceSettings,
        modelId: 'eleven_turbo_v2_5',
      }),
      expect.anything(),
    );
  });

  it('handles ReadableStream responses from the ElevenLabs SDK', async () => {
    const { context } = createContext();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    convertHandler.mockResolvedValue(stream);
    getAudioDurationMock.mockResolvedValue(2.5);

    const provider = elevenLabsProviderFactory.create(context, {
      apiKey: 'key',
      voiceId: 'voice',
    });

    const result = await provider.generate('<speak>Stream</speak>');

    expect(result.size).toBe(3);
    const [bufferArg] = getAudioDurationMock.mock.calls[0] ?? [];
    expect(bufferArg?.equals(Buffer.from([1, 2, 3]))).toBe(true);
    expect(result.duration).toBe(2.5);
  });

  it('wraps unknown errors in TtsError with a descriptive message', async () => {
    const { context, logger } = createContext();
    const failure = new Error('kaput');
    convertHandler.mockRejectedValue(failure);

    const provider = elevenLabsProviderFactory.create(context, {
      apiKey: 'key',
      voiceId: 'voice',
    });

    await expect(provider.generate('<speak>Oops</speak>')).rejects.toBeInstanceOf(TtsError);
    await expect(provider.generate('<speak>Oops</speak>')).rejects.toThrow(
      'ElevenLabs generation failed: kaput',
    );
    expect(logger.error).toHaveBeenCalledWith(
      '[11labs] generation error',
      expect.objectContaining({ kind: 'TtsError' }),
    );
    expect(getAudioDurationMock).not.toHaveBeenCalled();
  });

  describe('error mapping', () => {
    async function tryGenerate(sdkError: unknown): Promise<unknown> {
      const { context } = createContext();
      convertHandler.mockRejectedValue(sdkError);
      const provider = elevenLabsProviderFactory.create(context, {
        apiKey: 'key',
        voiceId: 'voice',
      });
      try {
        await provider.generate('<speak>x</speak>');
      } catch (err) {
        return err;
      }
      throw new Error('expected generate() to throw');
    }

    it('maps 401 to TtsAuthenticationError', async () => {
      const err = await tryGenerate(
        new FakeElevenLabsError({ message: 'bad key', statusCode: 401 }),
      );
      expect(err).toBeInstanceOf(TtsAuthenticationError);
      expect((err as TtsAuthenticationError).statusCode).toBe(401);
    });

    it('maps 403 to TtsQuotaExceededError', async () => {
      const err = await tryGenerate(
        new FakeElevenLabsError({ message: 'tier exhausted', statusCode: 403 }),
      );
      expect(err).toBeInstanceOf(TtsQuotaExceededError);
    });

    it('maps 429 to TtsRateLimitError without Retry-After', async () => {
      const err = await tryGenerate(
        new FakeElevenLabsError({ message: 'slow down', statusCode: 429 }),
      );
      expect(err).toBeInstanceOf(TtsRateLimitError);
      expect((err as TtsRateLimitError).retryAfterMs).toBeUndefined();
    });

    it('maps 429 to TtsRateLimitError and parses Retry-After seconds', async () => {
      const err = await tryGenerate(
        new FakeElevenLabsError({
          message: 'slow down',
          statusCode: 429,
          rawResponse: { headers: { 'retry-after': '30' } },
        }),
      );
      expect(err).toBeInstanceOf(TtsRateLimitError);
      expect((err as TtsRateLimitError).retryAfterMs).toBe(30000);
    });

    it('maps 500/502/503 to TtsTransientError', async () => {
      for (const status of [500, 502, 503]) {
        const err = await tryGenerate(
          new FakeElevenLabsError({ message: 'upstream', statusCode: status }),
        );
        expect(err).toBeInstanceOf(TtsTransientError);
      }
    });

    it('maps 400 and 422 to TtsInvalidInputError', async () => {
      for (const status of [400, 422]) {
        const err = await tryGenerate(
          new FakeElevenLabsError({ message: 'bad input', statusCode: status }),
        );
        expect(err).toBeInstanceOf(TtsInvalidInputError);
      }
    });

    it('maps timeout to TtsTransientError', async () => {
      const err = await tryGenerate(new FakeElevenLabsTimeoutError('took too long'));
      expect(err).toBeInstanceOf(TtsTransientError);
    });

    it('maps SDK errors with no statusCode to TtsTransientError', async () => {
      const err = await tryGenerate(new FakeElevenLabsError({ message: 'network dropped' }));
      expect(err).toBeInstanceOf(TtsTransientError);
      expect((err as TtsTransientError).statusCode).toBeUndefined();
    });

    it('preserves the original error as cause', async () => {
      const sdkError = new FakeElevenLabsError({ message: 'x', statusCode: 500 });
      const err = await tryGenerate(sdkError);
      expect((err as TtsError).cause).toBe(sdkError);
    });
  });
});
