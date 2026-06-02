import type { TtsProviderContext } from '@alien-lobster-buffet/tts-conductor-core';
import { TtsError } from '@alien-lobster-buffet/tts-conductor-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { falProviderFactory } from '../falProvider';

const subscribeMock = vi.hoisted(() => vi.fn());
const createClientMock = vi.hoisted(() => vi.fn());

vi.mock('@fal-ai/client', () => ({
  createFalClient: (...args: unknown[]) => {
    createClientMock(...args);
    return { subscribe: (...inner: unknown[]) => subscribeMock(...inner) };
  },
}));

const ctx: TtsProviderContext = {
  id: 'fal',
  config: {
    pauseTable: {},
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
};

function stubFetch(bytes: number[] = [1, 2, 3], ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FalProvider.generate', () => {
  it('strips <speak>, builds input, subscribes, fetches audio, and returns providerMeta', async () => {
    subscribeMock.mockResolvedValue({
      data: {
        audio: { url: 'https://fal/out.mp3', content_type: 'audio/mpeg' },
        duration_ms: 2500,
      },
      requestId: 'req-abc',
    });
    const fetchMock = stubFetch([1, 2, 3, 4]);

    const provider = falProviderFactory.create(ctx, {
      apiKey: 'k',
      model: 'fal-ai/minimax/speech-02-hd',
      voice: { kind: 'preset', id: 'Wise_Woman' },
    });
    const res = await provider.generate('<speak>Hello world</speak>');

    expect(subscribeMock).toHaveBeenCalledTimes(1);
    const [endpoint, opts] = subscribeMock.mock.calls[0] as [
      string,
      { input: Record<string, unknown> },
    ];
    expect(endpoint).toBe('fal-ai/minimax/speech-02-hd');
    expect(opts.input.text).toBe('Hello world'); // <speak> wrapper stripped
    expect(opts.input.output_format).toBe('url');

    expect(fetchMock).toHaveBeenCalledWith('https://fal/out.mp3', expect.anything());
    expect(Buffer.isBuffer(res.audio)).toBe(true);
    expect(res.audio.length).toBe(4);
    expect(res.mimeType).toBe('audio/mpeg');
    expect(res.duration).toBeCloseTo(2.5); // minimax duration_ms / 1000
    expect(res.size).toBe(4);
    expect(res.providerMeta).toEqual({ request_id: 'req-abc' });
  });

  it('omits duration for models without one (gemini) so core ffprobe derives it', async () => {
    subscribeMock.mockResolvedValue({
      data: { audio: { url: 'https://fal/g.mp3' } },
      requestId: 'r',
    });
    stubFetch();

    const provider = falProviderFactory.create(ctx, {
      apiKey: 'k',
      model: 'fal-ai/gemini-3.1-flash-tts',
    });
    const res = await provider.generate('<speak>hi</speak>');
    expect(res.duration).toBeUndefined();
  });

  it('forwards the abort signal to both fal.subscribe and the audio fetch', async () => {
    subscribeMock.mockResolvedValue({
      data: { audio: { url: 'https://fal/a.mp3' } },
      requestId: 'r',
    });
    const fetchMock = stubFetch();
    const provider = falProviderFactory.create(ctx, {
      apiKey: 'k',
      model: 'fal-ai/gemini-3.1-flash-tts',
    });
    const controller = new AbortController();

    await provider.generate('<speak>hi</speak>', { signal: controller.signal });

    const subOpts = subscribeMock.mock.calls[0][1] as { abortSignal?: AbortSignal };
    expect(subOpts.abortSignal).toBe(controller.signal);
    const fetchOpts = fetchMock.mock.calls[0][1] as { signal?: AbortSignal };
    expect(fetchOpts.signal).toBe(controller.signal);
  });

  it('lets per-call voice overrides win over construction defaults', async () => {
    subscribeMock.mockResolvedValue({
      data: { audio: { url: 'https://fal/a.mp3' } },
      requestId: 'r',
    });
    stubFetch();
    const provider = falProviderFactory.create(ctx, {
      apiKey: 'k',
      model: 'fal-ai/elevenlabs/tts/turbo-v2.5',
      voice: { kind: 'preset', id: 'Rachel' },
    });

    await provider.generate('<speak>hi</speak>', {
      overrides: { voice: { kind: 'preset', id: 'Aria' } },
    });

    const input = subscribeMock.mock.calls[0][1].input as Record<string, unknown>;
    expect(input.voice).toBe('Aria');
  });

  it('throws AbortError before calling fal when the signal is already aborted', async () => {
    const provider = falProviderFactory.create(ctx, {
      apiKey: 'k',
      model: 'fal-ai/gemini-3.1-flash-tts',
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.generate('<speak>hi</speak>', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(subscribeMock).not.toHaveBeenCalled();
  });

  it('maps a fal.subscribe failure to a TtsError', async () => {
    subscribeMock.mockRejectedValue(new Error('boom'));
    const provider = falProviderFactory.create(ctx, {
      apiKey: 'k',
      model: 'fal-ai/gemini-3.1-flash-tts',
    });
    await expect(provider.generate('<speak>hi</speak>')).rejects.toBeInstanceOf(TtsError);
  });

  it('throws a TtsError when the audio fetch is not ok', async () => {
    subscribeMock.mockResolvedValue({
      data: { audio: { url: 'https://fal/a.mp3' } },
      requestId: 'r',
    });
    stubFetch([], false, 500);
    const provider = falProviderFactory.create(ctx, {
      apiKey: 'k',
      model: 'fal-ai/gemini-3.1-flash-tts',
    });
    await expect(provider.generate('<speak>hi</speak>')).rejects.toBeInstanceOf(TtsError);
  });

  it('propagates an AbortError thrown mid-subscribe (not wrapped as a TtsError)', async () => {
    subscribeMock.mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    const provider = falProviderFactory.create(ctx, {
      apiKey: 'k',
      model: 'fal-ai/gemini-3.1-flash-tts',
    });
    await expect(provider.generate('<speak>hi</speak>')).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('surfaces an AbortError (not the raw error) when the signal aborted but the SDK threw something else', async () => {
    const controller = new AbortController();
    subscribeMock.mockImplementation(async () => {
      controller.abort(); // cancelled by the time we reach the catch
      throw new Error('late API error');
    });
    const provider = falProviderFactory.create(ctx, {
      apiKey: 'k',
      model: 'fal-ai/gemini-3.1-flash-tts',
    });
    await expect(
      provider.generate('<speak>hi</speak>', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('falProviderFactory', () => {
  it('requires apiKey and a known model, and configures the fal client', () => {
    expect(() =>
      falProviderFactory.create(ctx, { apiKey: '', model: 'fal-ai/gemini-3.1-flash-tts' }),
    ).toThrow();
    // @ts-expect-error — unknown model id must be rejected at runtime
    expect(() => falProviderFactory.create(ctx, { apiKey: 'k', model: 'fal-ai/nope' })).toThrow();

    falProviderFactory.create(ctx, { apiKey: 'k', model: 'fal-ai/gemini-3.1-flash-tts' });
    // Instance-local client (credentials scoped here), not a global config call.
    expect(createClientMock).toHaveBeenCalledWith({ credentials: 'k' });
  });

  it('exposes caps and voiceCatalog from the bound model descriptor', () => {
    const gem = falProviderFactory.create(ctx, {
      apiKey: 'k',
      model: 'fal-ai/gemini-3.1-flash-tts',
    });
    expect(gem.id).toBe('fal');
    expect(gem.caps.maxCharsPerRequest).toBe(5000);
    expect(gem.caps.maxInlineBreakSeconds).toBeNull();
    expect(gem.voiceCatalog).toBeDefined();

    const cb = falProviderFactory.create(ctx, {
      apiKey: 'k',
      model: 'fal-ai/chatterbox/text-to-speech',
    });
    expect(cb.voiceCatalog).toBeUndefined();
  });
});
