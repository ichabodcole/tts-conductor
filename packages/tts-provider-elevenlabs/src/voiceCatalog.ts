import {
  TtsError,
  type VoiceCatalog,
  type VoiceCatalogEntry,
  type VoiceCatalogQuery,
} from '@alien-lobster-buffet/tts-conductor-core';
import type { ElevenLabs } from '@elevenlabs/elevenlabs-js';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';

/**
 * The raw ElevenLabs voice record exposed via `VoiceCatalogEntry.raw`. Re-exported
 * from the SDK so consumers can write `VoiceCatalogEntry<ElevenLabsRawVoice>` and
 * reach fields the common shape doesn't promote (`fineTuning`, `sharing`,
 * `verifiedLanguages` detail, `availableForTiers`, `safetyControl`, `samples`,
 * etc.).
 */
export type ElevenLabsRawVoice = ElevenLabs.Voice;

/**
 * Narrowed type helper for ElevenLabs' `recordingQuality` enum. Consumers using
 * the ElevenLabs adapter can import this for stricter typing than the
 * common-shape `VoiceCatalogEntry.tier?: string` field.
 */
export type ElevenLabsRecordingQuality = ElevenLabs.VoiceResponseModelRecordingQuality;

/**
 * Narrowed type helper for ElevenLabs' voice `category` enum.
 */
export type ElevenLabsVoiceCategory = ElevenLabs.VoiceResponseModelCategory;

/**
 * Page size used when fetching the catalog via ElevenLabs' v2 search endpoint.
 * 100 is the SDK's max; lower wouldn't hurt correctness but would multiply
 * round-trips for accounts with large catalogs.
 */
const CATALOG_PAGE_SIZE = 100;

/**
 * Convenience factory: construct an {@link ElevenLabsVoiceCatalog} from just an
 * API key, without requiring the consumer to import `@elevenlabs/elevenlabs-js`
 * themselves. Equivalent to `new ElevenLabsVoiceCatalog(new ElevenLabsClient({ apiKey }))`,
 * but keeps the SDK as an internal dependency of this adapter.
 */
export function createElevenLabsCatalog(apiKey: string): ElevenLabsVoiceCatalog {
  if (!apiKey) {
    throw new Error('createElevenLabsCatalog requires a non-empty apiKey');
  }
  return new ElevenLabsVoiceCatalog(new ElevenLabsClient({ apiKey }));
}

export class ElevenLabsVoiceCatalog implements VoiceCatalog<ElevenLabsRawVoice> {
  constructor(private readonly client: ElevenLabsClient) {}

  async listVoices(
    query?: VoiceCatalogQuery,
    options?: { signal?: AbortSignal },
  ): Promise<VoiceCatalogEntry<ElevenLabsRawVoice>[]> {
    options?.signal?.throwIfAborted();

    // Loop through pages — adapter handles pagination internally so consumers
    // receive a flat list per the VoiceCatalog contract.
    const collected: ElevenLabsRawVoice[] = [];
    let nextPageToken: string | undefined;

    do {
      options?.signal?.throwIfAborted();
      const response = await this.client.voices.search(
        {
          pageSize: CATALOG_PAGE_SIZE,
          // Server-side filters where the SDK supports them. `search` covers
          // name / description / labels / category natively.
          search: query?.search,
          // `personal` filters to user-owned voices only — maps to customOnly.
          voiceType: query?.customOnly ? 'personal' : undefined,
          nextPageToken,
        },
        { abortSignal: options?.signal },
      );
      collected.push(...response.voices);
      // Defensive: if the server claims more pages exist but didn't supply a
      // continuation token, silently truncating would violate the
      // VoiceCatalog "flat array — adapter loops through all pages" contract.
      // ElevenLabs always returns the token when hasMore is true today; the
      // throw exists so a future SDK regression surfaces immediately rather
      // than producing partial catalogs.
      if (response.hasMore && !response.nextPageToken) {
        throw new TtsError(
          '[11labs] voice catalog pagination: hasMore=true but no nextPageToken supplied',
        );
      }
      nextPageToken = response.hasMore ? response.nextPageToken : undefined;
    } while (nextPageToken);

    // Map every voice to the common shape.
    let entries = collected.map((v) => mapToCatalogEntry(v));

    // Apply remaining filters client-side (ElevenLabs doesn't support
    // language or gender as native filters on the search endpoint).
    if (query?.language) {
      const wanted = query.language.toLowerCase();
      entries = entries.filter((e) => e.languages.some((l) => l.toLowerCase().startsWith(wanted)));
    }
    if (query?.gender) {
      const wanted = query.gender.toLowerCase();
      entries = entries.filter((e) => e.gender?.toLowerCase() === wanted);
    }

    return entries;
  }
}

function mapToCatalogEntry(voice: ElevenLabsRawVoice): VoiceCatalogEntry<ElevenLabsRawVoice> {
  return {
    id: voice.voiceId,
    name: voice.name ?? '',
    // `verifiedLanguages` is the structured field per voice; fall back to a
    // freeform `language` label if the verified array is absent.
    languages: extractLanguages(voice),
    gender: voice.labels?.gender,
    // Recording quality is the closest cross-provider analog to "tier"; if
    // absent, fall back to the category enum (premade / cloned / etc.).
    tier: voice.recordingQuality ?? voice.category,
    previewUrl: voice.previewUrl ?? undefined,
    description: voice.description ?? undefined,
    labels: voice.labels,
    custom: voice.isOwner ?? undefined,
    raw: voice,
  };
}

function extractLanguages(voice: ElevenLabsRawVoice): string[] {
  if (voice.verifiedLanguages && voice.verifiedLanguages.length > 0) {
    return voice.verifiedLanguages
      .map((vl) => vl.language)
      .filter((l): l is string => typeof l === 'string' && l.length > 0);
  }
  // ElevenLabs occasionally encodes language in labels (e.g., {language: 'en'}).
  const fromLabel = voice.labels?.language;
  return typeof fromLabel === 'string' && fromLabel.length > 0 ? [fromLabel] : [];
}
