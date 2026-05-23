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
 * A TTS provider that turns one chunk of input into one audio buffer.
 *
 * The generic `TCallOverrides` lets a provider declare a shape for per-call
 * option overrides (A/B'ing voices, regenerating with different settings,
 * etc.) without consumers needing to construct a fresh provider instance
 * per variation. The orchestration path (`ttsGenerateFull`) does not pass
 * overrides — they're for consumers calling `provider.generate()` directly.
 *
 * Providers that don't support per-call overrides should leave `TCallOverrides`
 * at its default of `never` and ignore the second parameter; the contract stays
 * source-compatible with v1.1 consumers either way.
 */
export interface TtsProvider<TCallOverrides = never> {
  readonly id: string;
  readonly caps: ProviderCapabilities;
  generate(chunk: string, overrides?: TCallOverrides): Promise<GenerationResult>;
}
