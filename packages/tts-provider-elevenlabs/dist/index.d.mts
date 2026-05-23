import { TtsProviderFactory, VoiceCatalog, VoiceCatalogEntry, VoiceCatalogQuery } from "@alien-lobster-buffet/tts-conductor-core";
import { ElevenLabs, ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

//#region src/elevenLabsProvider.d.ts
/**
 * Voice settings for ElevenLabs TTS calls. Field names match the
 * `@elevenlabs/elevenlabs-js` SDK's camelCase TS interface exactly — the SDK
 * transforms camelCase to the API's wire-level snake_case internally.
 *
 * Passing snake_case keys (e.g., `similarity_boost: 0.8`) was silently dropped
 * by the SDK in earlier versions of this adapter because the SDK reads
 * `obj.similarityBoost` and finds undefined. Field names are camelCase here
 * to make that bug structurally impossible.
 */
interface ElevenLabsVoiceSettings {
  stability?: number | null;
  useSpeakerBoost?: boolean | null;
  similarityBoost?: number | null;
  style?: number | null;
  speed?: number | null;
}
type ElevenLabsQuality = 'draft' | 'standard' | 'high';
interface ElevenLabsProviderOptions {
  apiKey: string;
  voiceId: string;
  voiceSettings?: ElevenLabsVoiceSettings;
  quality?: ElevenLabsQuality;
}
/**
 * Per-call overrides for `ElevenLabsProvider.generate()`. Carries the subset
 * of construction-time options that are safe to vary per request — `apiKey`
 * stays bound at construction since a different API key is conceptually a
 * different provider instance.
 *
 * Useful for slot-versioning use cases (A/B testing a voice on the same
 * source text, regenerating one segment with different settings) without
 * spinning up a fresh provider instance per variation.
 */
interface ElevenLabsCallOverrides {
  voiceId?: string;
  /**
   * Per-call voice settings.
   *
   * **Replaces** the construction-time `voiceSettings` in full — this is NOT a
   * shallow merge. If you pass `{ stability: 0.9 }`, any other construction-time
   * settings (`speed`, `style`, `similarityBoost`, etc.) are dropped for this
   * call. Pass every field you want active on the call, not just the ones you
   * want to change. Full replacement keeps the override deterministic across
   * future SDK additions.
   */
  voiceSettings?: ElevenLabsVoiceSettings;
  quality?: ElevenLabsQuality;
}
declare module '@alien-lobster-buffet/tts-conductor-core' {
  interface TtsProviderRegistry {
    '11labs': ElevenLabsProviderOptions;
  }
  interface TtsProviderCallOverridesRegistry {
    '11labs': ElevenLabsCallOverrides;
  }
}
/**
 * ElevenLabs adapter defaults. These are the values the adapter reports to the
 * orchestrator and uses in SDK calls when the consumer doesn't override them.
 *
 * Consumer-configurable knobs (per-call overrides via `ElevenLabsCallOverrides`
 * or `BuildAudioOptions`):
 *   - voiceId, voiceSettings, quality (via overrides)
 *   - maxCharsPerRequest (via BuildAudioOptions.maxCharsPerRequest)
 *
 * Currently fixed (will become configurable when output-format config lands):
 *   - DEFAULT_OUTPUT_FORMAT — `mp3_44100_128` is ElevenLabs' standard MP3 at
 *     128kbps / 44.1kHz mono. Matches what the core stitcher's intermediate
 *     pipeline assumes (44.1kHz mono).
 *
 * Provider-shape (not appropriate to make per-call configurable):
 *   - DEFAULT_MAX_INLINE_BREAK_SECONDS — informs the chunker about ElevenLabs'
 *     `<break time="Xs"/>` upper bound.
 *   - MODEL_IDS — the actual SDK model identifiers per quality tier.
 */
declare const ELEVENLABS_DEFAULTS: {
  /**
   * Default per-request character budget reported via `caps.maxCharsPerRequest`.
   * ElevenLabs' actual server limit is higher (~5000), but a smaller default
   * gives better latency / progress granularity for typical narration workloads.
   * Consumers tuning for throughput can override via
   * {@link BuildAudioOptions.maxCharsPerRequest}.
   */
  maxCharsPerRequest: number;
  /**
   * Maximum length of an inline `<break time="Xs"/>` tag the adapter promises
   * to handle correctly. Longer pauses get rendered as separate silence
   * segments by the core orchestrator.
   */
  maxInlineBreakSeconds: number;
  /**
   * Default output format string passed to `textToSpeech.convert`. MP3 at
   * 44.1kHz / 128kbps — matches the core's intermediate-audio pipeline.
   */
  outputFormat: "mp3_44100_128";
  /**
   * Quality-tier → SDK model ID mapping. `high` deliberately maps to the same
   * model as `standard` because `eleven_multilingual_v2` is the highest-quality
   * model ElevenLabs currently exposes for this use case; `draft` swaps to the
   * faster turbo model.
   */
  models: {
    readonly draft: "eleven_turbo_v2_5";
    readonly standard: "eleven_multilingual_v2";
    readonly high: "eleven_multilingual_v2";
  };
};
declare const elevenLabsProviderFactory: TtsProviderFactory<'11labs', ElevenLabsCallOverrides>;
//#endregion
//#region src/voiceCatalog.d.ts
/**
 * The raw ElevenLabs voice record exposed via `VoiceCatalogEntry.raw`. Re-exported
 * from the SDK so consumers can write `VoiceCatalogEntry<ElevenLabsRawVoice>` and
 * reach fields the common shape doesn't promote (`fineTuning`, `sharing`,
 * `verifiedLanguages` detail, `availableForTiers`, `safetyControl`, `samples`,
 * etc.).
 */
type ElevenLabsRawVoice = ElevenLabs.Voice;
/**
 * Narrowed type helper for ElevenLabs' `recordingQuality` enum. Consumers using
 * the ElevenLabs adapter can import this for stricter typing than the
 * common-shape `VoiceCatalogEntry.tier?: string` field.
 */
type ElevenLabsRecordingQuality = ElevenLabs.VoiceResponseModelRecordingQuality;
/**
 * Narrowed type helper for ElevenLabs' voice `category` enum.
 */
type ElevenLabsVoiceCategory = ElevenLabs.VoiceResponseModelCategory;
declare class ElevenLabsVoiceCatalog implements VoiceCatalog<ElevenLabsRawVoice> {
  private readonly client;
  constructor(client: ElevenLabsClient);
  listVoices(query?: VoiceCatalogQuery, options?: {
    signal?: AbortSignal;
  }): Promise<VoiceCatalogEntry<ElevenLabsRawVoice>[]>;
}
//#endregion
export { ELEVENLABS_DEFAULTS, type ElevenLabsCallOverrides, type ElevenLabsProviderOptions, type ElevenLabsQuality, type ElevenLabsRawVoice, type ElevenLabsRecordingQuality, ElevenLabsVoiceCatalog, type ElevenLabsVoiceCategory, type ElevenLabsVoiceSettings, elevenLabsProviderFactory };
//# sourceMappingURL=index.d.mts.map