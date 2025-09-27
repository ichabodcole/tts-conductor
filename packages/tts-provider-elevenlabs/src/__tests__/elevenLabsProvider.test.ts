import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TtsProviderContext, TtsRuntimeConfig } from '@tts-conductor/core';

const convertHandler = vi.hoisted(() => vi.fn());
const ElevenLabsClientMock = vi.hoisted(() =>
  vi.fn(() => ({
    textToSpeech: {
      convert: convertHandler,
    },
  })),
);

vi.mock('@elevenlabs/elevenlabs-js', () => ({
  ElevenLabsClient: ElevenLabsClientMock,
}));

const getAudioDurationMock = vi.hoisted(() => vi.fn().mockResolvedValue(1.5));

vi.mock('@tts-conductor/core', async () => {
  const actual = await vi.importActual<any>('@tts-conductor/core');
  return {
    ...actual,
    getAudioDuration: getAudioDurationMock,
  };
});

let elevenLabsProviderFactory: (typeof import('../elevenLabsProvider'))['elevenLabsProviderFactory'];

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
    context: { config },
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
    );
    const [bufferArg] = getAudioDurationMock.mock.calls[0] ?? [];
    expect(Buffer.isBuffer(bufferArg)).toBe(true);
    expect(bufferArg?.toString()).toBe('hello');
    expect(result.duration).toBe(1.5);
    expect(result.size).toBeGreaterThan(0);
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

  it('throws with a descriptive error when ElevenLabs conversion fails', async () => {
    const { context, logger } = createContext();
    const failure = new Error('kaput');
    convertHandler.mockRejectedValue(failure);

    const provider = elevenLabsProviderFactory.create(context, {
      apiKey: 'key',
      voiceId: 'voice',
    });

    await expect(provider.generate('<speak>Oops</speak>')).rejects.toThrow(
      'ElevenLabs generation failed: kaput',
    );
    expect(logger.error).toHaveBeenCalledWith('[11labs] generation error', { message: 'kaput' });
    expect(getAudioDurationMock).not.toHaveBeenCalled();
  });
});
