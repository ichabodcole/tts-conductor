import type { VoiceCatalog } from './voice-catalog';

export interface ProviderCapabilities {
  /** null if provider cannot inline breaks */
  maxInlineBreakSeconds: number | null;
  maxCharsPerRequest?: number;
  renderInlineBreak?: (seconds: number) => string;
}

export interface GenerationResult {
  /** Generated audio for the requested chunk. */
  audio: Buffer;
  /** MIME type if the provider returns one (e.g., `audio/mpeg`). */
  mimeType?: string;
  /**
   * Audio duration in seconds.
   *
   * **Providers SHOULD supply this whenever the upstream API returns it.**
   * When omitted, the orchestrator falls back to running `ffprobe` over the
   * audio buffer to extract the duration — adds 50-100ms per chunk on the
   * critical path. For a 20-chunk job that's 1-2 seconds of overhead that
   * the upstream API already had the answer for.
   *
   * If the upstream API returns audio without a duration header (rare, but
   * possible for some streaming endpoints), leave this undefined and the
   * ffprobe fallback runs.
   */
  duration?: number;
  /** Audio buffer size in bytes if the provider returns it. */
  size?: number;
  /**
   * Opaque, provider-specific metadata for this chunk. Core never interprets
   * it — it forwards the object onto the `chunk-complete` lifecycle event and
   * collects it into the chunk-indexed `BuildFinalAudioResult.providerMeta`
   * list. Use it to surface async-billing identifiers (e.g., a fal
   * `request_id`) or any other per-call provider detail consumers need to
   * reconcile after the job completes. Keeping it generic — rather than a named
   * `requestId` field — keeps core free of any single provider's vocabulary.
   */
  providerMeta?: Record<string, unknown>;
}

/**
 * Per-call options for `TtsProvider.generate()`. Wraps the two orthogonal
 * concerns that surfaced separately in A2 (per-call overrides) and A3
 * (cancellation) so the `generate()` signature stays a stable two-argument
 * shape as we add more per-call concerns later.
 *
 * - `overrides` carries provider-specific option overrides (e.g.,
 *   `ElevenLabsCallOverrides` for the 11labs adapter). Shape comes from the
 *   provider's `TCallOverrides` generic.
 * - `signal` is forwarded to the upstream SDK and any internal ffmpeg/ffprobe
 *   spawn so consumers can wire up BullMQ job cancellation, request aborts,
 *   etc. Aborting a pending generate rejects the returned Promise.
 */
export interface GenerateCallOptions<TCallOverrides = never> {
  overrides?: TCallOverrides;
  signal?: AbortSignal;
}

/**
 * A TTS provider that turns one chunk of input into one audio buffer.
 *
 * The generic `TCallOverrides` lets a provider declare a shape for per-call
 * option overrides (A/B'ing voices, regenerating with different settings,
 * etc.) without consumers needing to construct a fresh provider instance
 * per variation.
 *
 * Providers that don't support per-call overrides should leave `TCallOverrides`
 * at its default of `never`. The second parameter is always optional, so the
 * contract stays compatible with consumers that only call `provider.generate(chunk)`.
 */
export interface TtsProvider<TCallOverrides = never> {
  readonly id: string;
  readonly caps: ProviderCapabilities;
  generate(chunk: string, options?: GenerateCallOptions<TCallOverrides>): Promise<GenerationResult>;
  /**
   * Optional voice catalog access. Providers that expose a voice-picker concept
   * (ElevenLabs, Cartesia, Hume, Fish.audio, PlayHT, Azure, Google, Piper)
   * implement this; providers without (OpenAI's fixed enum, Deepgram's static
   * model strings, a custom self-hosted server) leave it undefined. Consumers
   * detect availability via a simple existence check: `if (provider.voiceCatalog)`.
   */
  readonly voiceCatalog?: VoiceCatalog;
}
