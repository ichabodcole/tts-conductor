import type { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ElevenLabsVoiceCatalog } from '../voiceCatalog';

type SearchFn = ElevenLabsClient['voices']['search'];

function makeVoice(overrides: Partial<Record<string, unknown>> = {}): unknown {
  return {
    voiceId: 'voice-1',
    name: 'Test Voice',
    category: 'premade',
    description: 'A test voice',
    previewUrl: 'https://example.test/preview.mp3',
    labels: { gender: 'female', accent: 'american' },
    isOwner: false,
    recordingQuality: 'studio',
    verifiedLanguages: [{ language: 'en-US' }],
    ...overrides,
  };
}

function makeClient(searchImpl: SearchFn): ElevenLabsClient {
  return {
    voices: {
      search: searchImpl,
    },
  } as unknown as ElevenLabsClient;
}

describe('ElevenLabsVoiceCatalog', () => {
  let searchMock: ReturnType<typeof vi.fn>;
  let client: ElevenLabsClient;
  let catalog: ElevenLabsVoiceCatalog;

  beforeEach(() => {
    searchMock = vi.fn();
    client = makeClient(searchMock as unknown as SearchFn);
    catalog = new ElevenLabsVoiceCatalog(client);
  });

  it('maps a basic ElevenLabs voice to the common VoiceCatalogEntry shape', async () => {
    searchMock.mockResolvedValueOnce({
      voices: [makeVoice()],
      hasMore: false,
    });

    const result = await catalog.listVoices();

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'voice-1',
      name: 'Test Voice',
      languages: ['en-US'],
      gender: 'female',
      tier: 'studio',
      previewUrl: 'https://example.test/preview.mp3',
      description: 'A test voice',
      labels: { gender: 'female', accent: 'american' },
      custom: false,
    });
    // raw field carries the full record for consumers who need extras.
    expect(result[0]?.raw).toMatchObject({ voiceId: 'voice-1', category: 'premade' });
  });

  it('falls back to category when recordingQuality is absent', async () => {
    searchMock.mockResolvedValueOnce({
      voices: [makeVoice({ recordingQuality: undefined, category: 'cloned' })],
      hasMore: false,
    });

    const result = await catalog.listVoices();
    expect(result[0]?.tier).toBe('cloned');
  });

  it('extracts languages from verifiedLanguages when present', async () => {
    searchMock.mockResolvedValueOnce({
      voices: [
        makeVoice({
          verifiedLanguages: [{ language: 'en-US' }, { language: 'es-ES' }],
        }),
      ],
      hasMore: false,
    });

    const result = await catalog.listVoices();
    expect(result[0]?.languages).toEqual(['en-US', 'es-ES']);
  });

  it('falls back to labels.language when verifiedLanguages is empty', async () => {
    searchMock.mockResolvedValueOnce({
      voices: [
        makeVoice({
          verifiedLanguages: undefined,
          labels: { language: 'fr' },
        }),
      ],
      hasMore: false,
    });

    const result = await catalog.listVoices();
    expect(result[0]?.languages).toEqual(['fr']);
  });

  it('filters out undefined / empty language entries from verifiedLanguages', async () => {
    // Defensive code path: if the SDK ever returns verifiedLanguages entries
    // with missing or empty `language` fields, those should drop out rather
    // than producing entries like `languages: [undefined, '']` in the output.
    searchMock.mockResolvedValueOnce({
      voices: [
        makeVoice({
          verifiedLanguages: [
            { language: 'en-US' },
            { language: undefined },
            { language: '' },
            { language: 'fr-FR' },
          ],
        }),
      ],
      hasMore: false,
    });

    const result = await catalog.listVoices();
    expect(result[0]?.languages).toEqual(['en-US', 'fr-FR']);
  });

  it('throws TtsError when the SDK reports hasMore=true but omits nextPageToken (defensive guard)', async () => {
    // Pagination contract: if a future SDK regression returns hasMore=true
    // without a continuation token, we throw rather than silently truncate
    // the catalog — that violates the "flat array, adapter loops through all
    // pages" contract on VoiceCatalog.listVoices.
    searchMock.mockResolvedValueOnce({
      voices: [makeVoice({ voiceId: 'voice-1' })],
      hasMore: true,
      // nextPageToken intentionally omitted
    });

    await expect(catalog.listVoices()).rejects.toThrow(/pagination/);
  });

  it('returns an empty languages array when neither source is present', async () => {
    searchMock.mockResolvedValueOnce({
      voices: [makeVoice({ verifiedLanguages: undefined, labels: {} })],
      hasMore: false,
    });

    const result = await catalog.listVoices();
    expect(result[0]?.languages).toEqual([]);
  });

  it('flags custom=true when isOwner is true', async () => {
    searchMock.mockResolvedValueOnce({
      voices: [makeVoice({ isOwner: true })],
      hasMore: false,
    });

    const result = await catalog.listVoices();
    expect(result[0]?.custom).toBe(true);
  });

  it('loops through pages until hasMore is false (adapter handles pagination)', async () => {
    searchMock
      .mockResolvedValueOnce({
        voices: [makeVoice({ voiceId: 'voice-1' })],
        hasMore: true,
        nextPageToken: 'page-2',
      })
      .mockResolvedValueOnce({
        voices: [makeVoice({ voiceId: 'voice-2' })],
        hasMore: true,
        nextPageToken: 'page-3',
      })
      .mockResolvedValueOnce({
        voices: [makeVoice({ voiceId: 'voice-3' })],
        hasMore: false,
      });

    const result = await catalog.listVoices();

    expect(result).toHaveLength(3);
    expect(result.map((e) => e.id)).toEqual(['voice-1', 'voice-2', 'voice-3']);
    // Three SDK calls; the second and third advance the nextPageToken.
    expect(searchMock).toHaveBeenCalledTimes(3);
    expect(searchMock.mock.calls[1]?.[0]).toMatchObject({ nextPageToken: 'page-2' });
    expect(searchMock.mock.calls[2]?.[0]).toMatchObject({ nextPageToken: 'page-3' });
  });

  it('passes the search query to the SDK server-side', async () => {
    searchMock.mockResolvedValueOnce({ voices: [], hasMore: false });
    await catalog.listVoices({ search: 'sarah' });
    expect(searchMock.mock.calls[0]?.[0]).toMatchObject({ search: 'sarah' });
  });

  it('maps customOnly: true to voiceType: personal server-side', async () => {
    searchMock.mockResolvedValueOnce({ voices: [], hasMore: false });
    await catalog.listVoices({ customOnly: true });
    expect(searchMock.mock.calls[0]?.[0]).toMatchObject({ voiceType: 'personal' });
  });

  it('applies language filter client-side as a prefix match', async () => {
    searchMock.mockResolvedValueOnce({
      voices: [
        makeVoice({ voiceId: 'en-us', verifiedLanguages: [{ language: 'en-US' }] }),
        makeVoice({ voiceId: 'en-gb', verifiedLanguages: [{ language: 'en-GB' }] }),
        makeVoice({ voiceId: 'es-es', verifiedLanguages: [{ language: 'es-ES' }] }),
      ],
      hasMore: false,
    });

    const enOnly = await catalog.listVoices({ language: 'en' });
    expect(enOnly.map((e) => e.id)).toEqual(['en-us', 'en-gb']);

    searchMock.mockResolvedValueOnce({
      voices: [
        makeVoice({ voiceId: 'en-us', verifiedLanguages: [{ language: 'en-US' }] }),
        makeVoice({ voiceId: 'en-gb', verifiedLanguages: [{ language: 'en-GB' }] }),
      ],
      hasMore: false,
    });

    const enUsOnly = await catalog.listVoices({ language: 'en-US' });
    expect(enUsOnly.map((e) => e.id)).toEqual(['en-us']);
  });

  it('applies gender filter client-side, case-insensitive', async () => {
    searchMock.mockResolvedValueOnce({
      voices: [
        makeVoice({ voiceId: 'f', labels: { gender: 'female' } }),
        makeVoice({ voiceId: 'm', labels: { gender: 'Male' } }),
      ],
      hasMore: false,
    });

    const result = await catalog.listVoices({ gender: 'MALE' });
    expect(result.map((e) => e.id)).toEqual(['m']);
  });

  it('throws AbortError immediately when given a pre-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      catalog.listVoices(undefined, { signal: controller.signal }),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(searchMock).not.toHaveBeenCalled();
  });

  it('forwards the signal to the SDK as abortSignal', async () => {
    const controller = new AbortController();
    searchMock.mockResolvedValueOnce({ voices: [], hasMore: false });

    await catalog.listVoices(undefined, { signal: controller.signal });

    expect(searchMock.mock.calls[0]?.[1]).toMatchObject({ abortSignal: controller.signal });
  });
});
