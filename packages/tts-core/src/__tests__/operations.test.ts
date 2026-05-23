import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TtsRuntimeConfig } from '../config';
import { ttsGenerateFull, withTimeout } from '../operations';
import type { GenerationResult, TtsProvider } from '../provider';

const parseScriptMock = vi.hoisted(() => vi.fn());
const toChunksMock = vi.hoisted(() => vi.fn());
const getAudioDurationMock = vi.hoisted(() => vi.fn());
const buildFinalAudioMock = vi.hoisted(() => vi.fn());
const saveDebugFromBufferMock = vi.hoisted(() => vi.fn());

vi.mock('../utils/segmenter', () => ({
  parseScript: vi.fn((...args) => parseScriptMock(...args)),
}));

vi.mock('../utils/chunker', () => ({
  toChunks: vi.fn((...args) => toChunksMock(...args)),
}));

vi.mock('../utils/duration', () => ({
  getAudioDuration: vi.fn((...args) => getAudioDurationMock(...args)),
}));

vi.mock('../utils/stitcher', () => ({
  buildFinalAudio: vi.fn((...args) => buildFinalAudioMock(...args)),
}));

vi.mock('../utils/debug', () => ({
  saveDebugFromBuffer: vi.fn((...args) => saveDebugFromBufferMock(...args)),
}));

describe('ttsGenerateFull', () => {
  const runtimeConfig: TtsRuntimeConfig = {
    pauses: {},
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    parseScriptMock.mockReturnValue([{ kind: 'text', value: 'Hello world' }]);
    toChunksMock.mockReturnValue([{ ssml: 'Hello world', postPause: 0 }]);
    getAudioDurationMock.mockResolvedValue(1.25);
    buildFinalAudioMock.mockResolvedValue({
      base64Data: 'ZmFrZQ==',
      mimeType: 'audio/mpeg',
      size: 4,
      duration: 1.25,
    });
    saveDebugFromBufferMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  let provider: TtsProvider;

  beforeEach(() => {
    provider = {
      id: 'test-provider',
      caps: { maxInlineBreakSeconds: 3, maxCharsPerRequest: 100 },
      async generate() {
        return {
          audio: Buffer.from('fake'),
          mimeType: 'audio/mpeg',
          duration: 1.25,
          size: 4,
        } satisfies GenerationResult;
      },
    } satisfies TtsProvider;
  });

  it('runs the full pipeline and reports progress', async () => {
    const onProgress = vi.fn();

    const generateSpy = vi.spyOn(provider, 'generate');

    const result = await ttsGenerateFull('Hello world', provider, runtimeConfig, onProgress, {
      debugJobId: 'job-123',
    });

    expect(parseScriptMock).toHaveBeenCalledWith(
      'Hello world',
      runtimeConfig.pauses,
      runtimeConfig.logger,
    );
    expect(toChunksMock).toHaveBeenCalled();
    expect(generateSpy).toHaveBeenCalledWith('<speak>Hello world</speak>');
    // Provider supplies duration, so ffprobe should not be called
    expect(getAudioDurationMock).not.toHaveBeenCalled();
    expect(saveDebugFromBufferMock).toHaveBeenCalledWith(
      runtimeConfig,
      expect.any(Buffer),
      expect.objectContaining({ jobId: 'job-123', stage: 'raw' }),
    );
    expect(buildFinalAudioMock).toHaveBeenCalled();

    expect(onProgress).toHaveBeenLastCalledWith(100);
    expect(result.mimeType).toBe('audio/mpeg');
  });

  it('throws when provider.generate exceeds timeout', async () => {
    const slowProvider: TtsProvider = {
      id: 'slow-provider',
      caps: provider.caps,
      generate: () =>
        new Promise<GenerationResult>((resolve) =>
          setTimeout(
            () =>
              resolve({
                audio: Buffer.from('late'),
                mimeType: 'audio/mpeg',
                duration: 1.25,
                size: 4,
              }),
            70_000,
          ),
        ),
    };
    const promise = ttsGenerateFull('Hello world', slowProvider, runtimeConfig);
    const expectation = expect(promise).rejects.toThrow(
      '[tts] Timeout after 60000ms during provider.generate chunk 0',
    );

    await vi.advanceTimersByTimeAsync(60_000);

    await expectation;
  });

  it('trusts provider-supplied duration without calling ffprobe', async () => {
    const providerWithDuration: TtsProvider = {
      id: 'fast-provider',
      caps: provider.caps,
      async generate() {
        return {
          audio: Buffer.from('fake'),
          duration: 2.5, // Provider supplies duration
        };
      },
    };

    await ttsGenerateFull('Hello', providerWithDuration, runtimeConfig);

    // ffprobe should NOT be called since provider supplied duration
    expect(getAudioDurationMock).not.toHaveBeenCalled();
  });

  it('falls back to ffprobe when provider omits duration', async () => {
    const providerWithoutDuration: TtsProvider = {
      id: 'minimal-provider',
      caps: provider.caps,
      async generate() {
        return {
          audio: Buffer.from('fake'),
          // No duration supplied
        };
      },
    };

    await ttsGenerateFull('Hello', providerWithoutDuration, runtimeConfig);

    // ffprobe SHOULD be called as fallback
    expect(getAudioDurationMock).toHaveBeenCalledWith(
      expect.any(Buffer),
      runtimeConfig.ffmpeg,
      runtimeConfig.logger,
    );
  });

  it('uses per-call pause table override when supplied (A1)', async () => {
    const callPauses = { CUSTOM_PAUSE: 7.5 };

    await ttsGenerateFull('Hello world', provider, runtimeConfig, undefined, {
      pauses: callPauses,
    });

    // parseScript should receive the per-call pauses, NOT the runtime-config pauses
    expect(parseScriptMock).toHaveBeenCalledWith('Hello world', callPauses, runtimeConfig.logger);
    expect(parseScriptMock).not.toHaveBeenCalledWith(
      'Hello world',
      runtimeConfig.pauses,
      runtimeConfig.logger,
    );
  });

  it('falls back to runtime-config pauses when no per-call override (A1)', async () => {
    await ttsGenerateFull('Hello world', provider, runtimeConfig);

    expect(parseScriptMock).toHaveBeenCalledWith(
      'Hello world',
      runtimeConfig.pauses,
      runtimeConfig.logger,
    );
  });

  it('uses per-call maxCharsPerRequest override when supplied (A5)', async () => {
    await ttsGenerateFull('Hello world', provider, runtimeConfig, undefined, {
      maxCharsPerRequest: 50,
    });

    // toChunks should receive caps with the overridden maxCharsPerRequest
    expect(toChunksMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ maxCharsPerRequest: 50 }),
      runtimeConfig.logger,
    );
    // Sanity: the provider's own caps had a different value
    expect(provider.caps.maxCharsPerRequest).not.toBe(50);
  });

  it('falls back to provider caps when no per-call maxCharsPerRequest (A5)', async () => {
    await ttsGenerateFull('Hello world', provider, runtimeConfig);

    expect(toChunksMock).toHaveBeenCalledWith(
      expect.anything(),
      provider.caps,
      runtimeConfig.logger,
    );
  });
});

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves before timeout', async () => {
    const promise = withTimeout(Promise.resolve('ok'), 1000, 'label');
    await vi.advanceTimersByTimeAsync(999);
    await expect(promise).resolves.toBe('ok');
  });

  it('rejects after timeout', async () => {
    const deferred = new Promise<string>(() => {});

    const promise = withTimeout(deferred, 1000, 'label');
    const expectation = expect(promise).rejects.toThrow('[tts] Timeout after 1000ms during label');

    await vi.advanceTimersByTimeAsync(1000);

    await expectation;
  });
});
