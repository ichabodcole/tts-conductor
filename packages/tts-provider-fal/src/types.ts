import type { ProviderCapabilities, VoiceCatalog } from '@alien-lobster-buffet/tts-conductor-core';

/**
 * fal endpoint ids supported by this provider. Extended as models are added;
 * each id must have a matching entry in the descriptor registry.
 */
export type FalModelId =
  | 'fal-ai/minimax/speech-02-hd'
  | 'fal-ai/gemini-3.1-flash-tts'
  | 'fal-ai/chatterbox/text-to-speech'
  | 'fal-ai/elevenlabs/tts/turbo-v2.5';

/** One speaker in a multi-speaker request (gemini `speakers[]`). */
export interface FalSpeaker {
  /** Alias used as a line prefix in the prompt (e.g. "Host:"). → SpeakerConfig.speaker_id */
  speakerId: string;
  /** A preset voice name. → SpeakerConfig.voice */
  voiceId: string;
}

/**
 * Polymorphic voice selection spanning fal's mechanisms. Object-voice (minimax
 * `voice_setting`) is not a separate kind — it's a `preset` id that the
 * descriptor nests into an object alongside its scalar params.
 */
export type FalVoiceSelection =
  | { kind: 'preset'; id: string }
  | { kind: 'multiSpeaker'; speakers: FalSpeaker[] }
  | { kind: 'clone'; audioUrl: string };

/**
 * Normalized, model-agnostic input the provider assembles per call before a
 * descriptor maps it onto a specific model's wire schema.
 */
export interface CanonicalTtsInput {
  /** Plain text for this chunk — already stripped of core's `<speak>` wrapper. */
  text: string;
  /** Resolved voice selection (per-call override ?? construction default). */
  voice?: FalVoiceSelection;
  /**
   * Resolved model-specific scalar knobs (speed, temperature, stability, …).
   * Opaque at this layer; each descriptor whitelists the keys it forwards, so a
   * typo'd param is a silent no-op rather than a crash.
   */
  params?: Record<string, unknown>;
}

/**
 * Where a model's audio lives in its fal response: a URL to fetch plus an
 * optional mime type. All four starter models return `audio` as a fal `File`
 * (`{ url, content_type? }`), so the provider's shared, abort-aware fetch turns
 * this into bytes — descriptors only need to *locate* it.
 */
export interface FalAudioLocation {
  url: string;
  mimeType?: string;
}

/**
 * Per-model adapter. The marketplace nature of fal is localized here: one
 * descriptor per `endpointId`, all sharing the provider's `fal.subscribe` /
 * fetch / abort plumbing.
 */
export interface FalModelDescriptor {
  endpointId: FalModelId;
  /**
   * Per-model capabilities (incl. `maxCharsPerRequest`). fal engines don't
   * render SSML breaks, so `maxInlineBreakSeconds` is always `null` — long
   * pauses become stitched silence segments via the core orchestrator.
   */
  caps: ProviderCapabilities;
  /** Map canonical input → this model's fal wire input (text key, voice encoding, defaults). */
  buildInput(input: CanonicalTtsInput): Record<string, unknown>;
  /** Locate the audio URL (+ mime) in this model's fal response. */
  extractAudio(data: unknown): FalAudioLocation;
  /**
   * Pull duration (seconds) from the response when the model returns it. Only
   * minimax does (`duration_ms`); the others omit this and let core's ffprobe
   * derive duration.
   */
  extractDuration?(data: unknown): number | undefined;
  /** Enumerable speaker list, for models that expose one. */
  voiceCatalog?: VoiceCatalog;
}
