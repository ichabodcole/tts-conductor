//#region src/config.d.ts
declare enum ProcessStage {
  /** Individual audio chunks from providers */
  Raw = "raw",
  /** Final assembled audio after stitching */
  Final = "final",
  /** Fallback stage when not specified by caller */
  Unknown = "unknown"
}
interface TtsLogger {
  debug?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}
interface DebugMeta {
  fileName: string;
  jobId?: string;
  stage: ProcessStage | string;
  [key: string]: unknown;
}
interface DebugSink {
  saveBuffer?: (buffer: Buffer, meta: DebugMeta) => Promise<void> | void;
  saveFile?: (path: string, meta: DebugMeta) => Promise<void> | void;
}
interface FfmpegConfig {
  ffmpegPath?: string;
  ffprobePath?: string;
}
interface TtsRuntimeConfig {
  /** Map of pause labels (e.g. FULL_BREATH) to seconds */
  pauses: Record<string, number>;
  logger?: TtsLogger;
  debug?: DebugSink;
  ffmpeg?: FfmpegConfig;
}
interface BuildAudioOptions {
  debugJobId?: string;
  /**
   * Per-call pause table override. When provided, this replaces
   * {@link TtsRuntimeConfig.pauses} for this call only — useful when one
   * conductor instance serves multiple tenants or contexts that each need
   * a distinct pause vocabulary without paying for a per-tenant conductor.
   *
   * If omitted, the conductor falls back to the pause table on its
   * {@link TtsRuntimeConfig}.
   */
  pauses?: Record<string, number>;
  /**
   * Per-call override for {@link ProviderCapabilities.maxCharsPerRequest}.
   * When provided as a positive integer, chunking uses this limit instead of
   * the provider's own declared limit — useful for tuning latency / progress
   * granularity per call without forking the provider.
   *
   * Non-positive values (`0` or negative) are silently treated as no override
   * (every character becoming its own chunk would break the pipeline). If
   * omitted or invalid, the provider's `caps.maxCharsPerRequest` is used.
   */
  maxCharsPerRequest?: number;
}
//#endregion
//#region src/provider.d.ts
interface ProviderCapabilities {
  /** null if provider cannot inline breaks */
  maxInlineBreakSeconds: number | null;
  maxCharsPerRequest?: number;
  renderInlineBreak?: (seconds: number) => string;
}
interface GenerationResult {
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
interface TtsProvider<TCallOverrides = never> {
  readonly id: string;
  readonly caps: ProviderCapabilities;
  generate(chunk: string, overrides?: TCallOverrides): Promise<GenerationResult>;
}
//#endregion
//#region src/factory.d.ts
interface TtsProviderContext {
  config: TtsRuntimeConfig;
  id: string;
}
/**
 * Provider registry interface that can be extended by provider packages
 * to register their specific option types.
 *
 * Example usage in a provider package:
 *
 * declare module '@tts-conductor/core' {
 *   interface TtsProviderRegistry {
 *     '11labs': ElevenLabsProviderOptions;
 *     'my-provider': MyProviderOptions;
 *   }
 * }
 */
interface TtsProviderRegistry {}
/**
 * Type helper to get the options type for a specific provider ID
 */
type ProviderOptionsFor<T extends keyof TtsProviderRegistry> = TtsProviderRegistry[T];
/**
 * Type helper to get all registered provider IDs
 */
type RegisteredProviderIds = keyof TtsProviderRegistry;
/**
 * Parallel registry for per-call override types. Providers that accept per-call
 * overrides on `generate()` register their override-shape here via module
 * augmentation, alongside their construction-time options entry in
 * `TtsProviderRegistry`. Providers that don't support per-call overrides leave
 * this unregistered — `CallOverridesFor<T>` resolves to `never` for them.
 *
 * Example usage in a provider package:
 *
 * declare module '@tts-conductor/core' {
 *   interface TtsProviderRegistry {
 *     'my-provider': MyProviderOptions;
 *   }
 *   interface TtsProviderCallOverridesRegistry {
 *     'my-provider': MyProviderCallOverrides;
 *   }
 * }
 */
interface TtsProviderCallOverridesRegistry {}
/**
 * Resolves to the per-call overrides type registered for provider ID `T`, or
 * `never` if `T` does not have a `TtsProviderCallOverridesRegistry` entry. Used
 * by `TtsConductor.createProvider` to return a properly-typed provider so
 * `provider.generate(chunk, overrides)` typechecks against the registered
 * override shape.
 */
type CallOverridesFor<T extends string> = T extends keyof TtsProviderCallOverridesRegistry ? TtsProviderCallOverridesRegistry[T] : never;
/**
 * Type-safe factory interface for registered providers.
 *
 * `TCallOverrides` declares the shape of per-call overrides that the produced
 * provider accepts as the second argument to `generate()`. Defaults to `never`
 * for providers that don't support per-call overrides — keeps the factory
 * signature backward-compatible with v1.1 adapters.
 *
 * All providers must be registered in `TtsProviderRegistry` via module
 * augmentation.
 */
interface TtsProviderFactory<T extends RegisteredProviderIds, TCallOverrides = never> {
  id: T;
  create: (ctx: TtsProviderContext, options: ProviderOptionsFor<T>) => TtsProvider<TCallOverrides>;
}
//#endregion
//#region src/utils/pause.d.ts
type PauseTable = Record<string, number>;
/**
 * Parse pause duration from various pause formats
 * Supports patterns like:
 *   [PAUSE:LABEL]
 *   [PAUSE:LABEL:Nx]
 *   [PAUSE:LABEL:Ns]
 *   [PAUSE:Ns]
 */
declare function parsePauseDuration(pauseMatch: string, table: PauseTable): number;
declare function isValidPauseFormat(input: string): boolean;
declare function extractPauseMarkers(text: string): string[];
//#endregion
//#region src/utils/segmenter.d.ts
type Segment = {
  kind: 'text';
  value: string;
} | {
  kind: 'pause';
  label: string;
  seconds: number;
};
declare function parseScript(input: string, table: PauseTable, logger?: TtsLogger): Segment[];
//#endregion
//#region src/utils/chunker.d.ts
interface Chunk {
  ssml: string;
  postPause: number;
}
declare function toChunks(segments: Segment[], caps: ProviderCapabilities, logger?: TtsLogger): Chunk[];
//#endregion
//#region src/utils/stitcher.d.ts
interface AudioPart {
  buffer: Buffer;
  duration: number;
}
interface BuildFinalAudioResult {
  /** Final assembled audio as a Buffer. This is the primary way to read the result. */
  audio: Buffer;
  /**
   * Base64-encoded copy of `audio`, kept for backward compatibility with consumers that
   * cannot accept Buffers (e.g., JSON-only transport boundaries).
   *
   * @deprecated Prefer reading `audio` directly. This field will be removed in v2.0.
   *   Consumers that need base64 should call `result.audio.toString('base64')` themselves.
   */
  base64Data: string;
  mimeType: string;
  size: number;
  duration: number;
}
declare function buildFinalAudio(config: TtsRuntimeConfig, chunks: Chunk[], audio: AudioPart[], fileName?: string, options?: BuildAudioOptions): Promise<BuildFinalAudioResult>;
//#endregion
//#region src/conductor.d.ts
declare class TtsConductor {
  private readonly config;
  private providers;
  constructor(config: TtsRuntimeConfig);
  get runtimeConfig(): TtsRuntimeConfig;
  /**
   * Register a provider factory with type-safe options.
   * Provider must be registered in the TtsProviderRegistry via module augmentation.
   */
  registerProvider<T extends RegisteredProviderIds, TCallOverrides = CallOverridesFor<T>>(factory: TtsProviderFactory<T, TCallOverrides>): T;
  hasProvider(id: string): boolean;
  listProviders(): string[];
  /**
   * Create a provider instance with type-safe options.
   * Provider must be registered in the TtsProviderRegistry via module augmentation.
   */
  createProvider<T extends RegisteredProviderIds>(id: T, options: ProviderOptionsFor<T>): TtsProvider<CallOverridesFor<T>>;
  generateFull(rawText: string, provider: TtsProvider, onProgress?: (percent: number) => void, options?: BuildAudioOptions): Promise<BuildFinalAudioResult>;
}
declare function createTtsConductor(config: TtsRuntimeConfig): TtsConductor;
//#endregion
//#region src/defaults.d.ts
declare const DEFAULT_PAUSE_TABLE: PauseTable;
//#endregion
//#region src/errors.d.ts
/**
 * Error hierarchy for TTS provider failures. Adapters convert SDK-specific errors
 * to these classes so consumers can apply uniform retry / classification logic
 * without parsing error messages.
 *
 * Consumers should use `instanceof` checks rather than string matching:
 *
 * ```ts
 * try {
 *   await provider.generate(chunk);
 * } catch (err) {
 *   if (err instanceof TtsRateLimitError) {
 *     await sleep(err.retryAfterMs ?? 1000);
 *     // retry
 *   } else if (err instanceof TtsTransientError) {
 *     // exponential backoff
 *   } else if (err instanceof TtsInvalidInputError) {
 *     // do not retry; surface to caller
 *   }
 * }
 * ```
 */
/** Base class for all TTS provider errors. Direct instances signal an unclassified failure. */
declare class TtsError extends Error {
  /** The underlying error that triggered this one, if any. */
  readonly cause?: unknown;
  /** HTTP status code from the upstream API, if available. */
  readonly statusCode?: number;
  constructor(message: string, options?: {
    cause?: unknown;
    statusCode?: number;
  });
}
/**
 * Provider rejected the request because the caller has exceeded a rate limit.
 * Retry after `retryAfterMs` if supplied, otherwise apply caller-default backoff.
 */
declare class TtsRateLimitError extends TtsError {
  /** Milliseconds to wait before retrying, parsed from the upstream Retry-After header if present. */
  readonly retryAfterMs?: number;
  constructor(message: string, options?: {
    cause?: unknown;
    statusCode?: number;
    retryAfterMs?: number;
  });
}
/**
 * Provider rejected the request because the caller has exhausted their quota or
 * subscription tier. Retrying without consumer action (upgrade, top-up) will keep failing.
 */
declare class TtsQuotaExceededError extends TtsError {
  constructor(message: string, options?: {
    cause?: unknown;
    statusCode?: number;
  });
}
/**
 * Provider rejected the credentials. The API key is missing, invalid, or revoked.
 * Retrying will not help until the caller fixes their authentication.
 */
declare class TtsAuthenticationError extends TtsError {
  constructor(message: string, options?: {
    cause?: unknown;
    statusCode?: number;
  });
}
/**
 * Provider failure that is expected to resolve on retry: 5xx responses, network errors,
 * upstream timeouts, transient connectivity issues. Safe to retry with exponential backoff.
 */
declare class TtsTransientError extends TtsError {
  constructor(message: string, options?: {
    cause?: unknown;
    statusCode?: number;
  });
}
/**
 * Provider rejected the request because the input was malformed or unprocessable.
 * Retrying with the same input will not help; the caller must fix the input.
 */
declare class TtsInvalidInputError extends TtsError {
  constructor(message: string, options?: {
    cause?: unknown;
    statusCode?: number;
  });
}
//#endregion
//#region src/operations.d.ts
declare function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T>;
declare function ttsGenerateFull(rawText: string, provider: TtsProvider, config: TtsRuntimeConfig, onProgress?: (percent: number) => void, options?: BuildAudioOptions): Promise<BuildFinalAudioResult>;
//#endregion
//#region src/utils/duration.d.ts
declare function getAudioDuration(audioBuffer: Buffer, ffmpegConfig?: FfmpegConfig, logger?: TtsLogger): Promise<number>;
declare function estimateAudioDuration(audioBuffer: Buffer, bitrate?: number): number;
//#endregion
export { type BuildAudioOptions, type BuildFinalAudioResult, type CallOverridesFor, DEFAULT_PAUSE_TABLE, type DebugMeta, type DebugSink, type FfmpegConfig, type GenerationResult, type PauseTable, ProcessStage, type ProviderCapabilities, type ProviderOptionsFor, type RegisteredProviderIds, type Segment, TtsAuthenticationError, TtsConductor, TtsError, TtsInvalidInputError, type TtsLogger, type TtsProvider, type TtsProviderCallOverridesRegistry, type TtsProviderContext, type TtsProviderFactory, type TtsProviderRegistry, TtsQuotaExceededError, TtsRateLimitError, type TtsRuntimeConfig, TtsTransientError, buildFinalAudio, createTtsConductor, estimateAudioDuration, extractPauseMarkers, getAudioDuration, isValidPauseFormat, parsePauseDuration, parseScript, toChunks, ttsGenerateFull, withTimeout };
//# sourceMappingURL=index.d.mts.map