export interface ProviderCapabilities {
  /** null if provider cannot inline breaks */
  maxInlineBreakSeconds: number | null;
  maxCharsPerRequest?: number;
  renderInlineBreak?: (seconds: number) => string;
}

export interface GenerationResult {
  audio: Buffer;
  mimeType?: string;
  duration?: number;
  size?: number;
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
}
