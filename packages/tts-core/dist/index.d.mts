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
//#region src/defaults.d.ts
declare const DEFAULT_PAUSE_TABLE: PauseTable;
/**
 * Default timeouts (milliseconds) for each waited operation in the orchestration
 * pipeline. Consumers can override any subset of these via
 * {@link TtsRuntimeConfig.timeouts}; whatever they don't supply falls back here.
 *
 * Values reflect what the library historically hardcoded and have proven
 * reasonable in production for ElevenLabs at typical chunk sizes (~1200 chars).
 * Long segments, slow upstream days, or larger chunk budgets may want higher
 * values — that's exactly what the override surface is for.
 */
declare const DEFAULT_TIMEOUTS: {
  /** Per-chunk provider.generate() wrapping timeout (entire upstream call). */readonly generate: 60000; /** Per-chunk ffmpeg transcode (MP3 → intermediate WAV). */
  readonly transcode: 30000; /** Silence-WAV generation (cached after first build per duration). */
  readonly silenceGen: 30000; /** Concat-demuxer concatenation (fast path). */
  readonly concat: 45000; /** Filter-graph concat fallback (slower, re-encodes from scratch). */
  readonly concatFilterFallback: 60000; /** Final audio encode (codec determined by the resolved OutputFormat). */
  readonly finalEncode: 45000; /** Outer wrap around buildFinalAudio inside the orchestration. */
  readonly stitch: 45000;
};
/**
 * Shape of a final-output format. Consumers either pick a preset from
 * {@link OUTPUT_FORMATS} or compose their own. The full object is required —
 * we deliberately do NOT accept `Partial<OutputFormat>` because mismatched
 * fields (e.g., Opus codec with MP3 container) silently produce wrong files.
 *
 * For custom-but-similar variants, spread a preset and override specific
 * fields, keeping the codec / container / mimeType triad coherent:
 *
 *   const customOpus = { ...OUTPUT_FORMATS.OPUS_64, bitrate: '96k' };
 *
 * Fields:
 * - `codec` — ffmpeg codec name passed to `-c:a` (e.g., `libmp3lame`,
 *   `libopus`, `flac`, `pcm_s16le`).
 * - `bitrate` — bitrate string passed to `-b:a` for lossy codecs (`'128k'`,
 *   `'192k'`, `'320k'`). Omit for lossless codecs (FLAC, PCM) — the field
 *   should be undefined in those presets.
 * - `sampleRateHz` — sample rate in Hz passed to `-ar` (44100, 48000, etc.).
 * - `channels` — channel count passed to `-ac` (1 = mono, 2 = stereo).
 * - `container` — file extension (without dot) and ffmpeg container name.
 *   Determines the output filename suffix.
 * - `mimeType` — MIME type surfaced on `BuildFinalAudioResult.mimeType`.
 */
interface OutputFormat {
  codec: string;
  bitrate?: string;
  sampleRateHz: number;
  channels: number;
  container: string;
  mimeType: string;
}
/**
 * Preset output formats covering the common consumer cases. Use one directly:
 *
 *   conductor.generateFull(text, provider, undefined, { output: OUTPUT_FORMATS.OPUS_64 });
 *
 * Or spread + override for variants (keep codec/container/mimeType coherent):
 *
 *   { output: { ...OUTPUT_FORMATS.MP3_192, channels: 2 } }   // stereo MP3
 *   { output: { ...OUTPUT_FORMATS.OPUS_64, bitrate: '96k' } } // higher-quality Opus
 *
 * Notes on the picks:
 * - Opus presets use 48kHz because Opus is designed around 48kHz internally
 *   (lower rates get upsampled, wasting bits).
 * - FLAC and WAV presets omit `bitrate` because they're lossless; supplying
 *   a bitrate to ffmpeg for these codecs is silently ignored.
 * - Default sample rate is 44.1kHz / mono — matches ElevenLabs' standard
 *   MP3 output and the intermediate-audio pipeline.
 */
declare const OUTPUT_FORMATS: {
  /** Spoken-word small-file MP3 — ~half the size of MP3_128 with little quality loss for narration. */readonly MP3_64: {
    readonly codec: "libmp3lame";
    readonly bitrate: "64k";
    readonly sampleRateHz: 44100;
    readonly channels: 1;
    readonly container: "mp3";
    readonly mimeType: "audio/mpeg";
  };
  readonly MP3_128: {
    readonly codec: "libmp3lame";
    readonly bitrate: "128k";
    readonly sampleRateHz: 44100;
    readonly channels: 1;
    readonly container: "mp3";
    readonly mimeType: "audio/mpeg";
  };
  readonly MP3_192: {
    readonly codec: "libmp3lame";
    readonly bitrate: "192k";
    readonly sampleRateHz: 44100;
    readonly channels: 1;
    readonly container: "mp3";
    readonly mimeType: "audio/mpeg";
  };
  readonly MP3_320: {
    readonly codec: "libmp3lame";
    readonly bitrate: "320k";
    readonly sampleRateHz: 44100;
    readonly channels: 1;
    readonly container: "mp3";
    readonly mimeType: "audio/mpeg";
  };
  readonly OPUS_64: {
    readonly codec: "libopus";
    readonly bitrate: "64k";
    readonly sampleRateHz: 48000;
    readonly channels: 1;
    readonly container: "opus";
    readonly mimeType: "audio/ogg; codecs=opus";
  };
  /**
   * Stereo Opus preset. Note: the intermediate pipeline is always 44.1kHz
   * mono pcm_s16le (required for ffmpeg concat-demuxer reliability), so
   * `channels: 2` here duplicates the mono signal across both channels —
   * the output file is technically stereo but carries no spatial information.
   * Real stereo TTS would require a different intermediate pipeline.
   */
  readonly OPUS_128_STEREO: {
    readonly codec: "libopus";
    readonly bitrate: "128k";
    readonly sampleRateHz: 48000;
    readonly channels: 2;
    readonly container: "opus";
    readonly mimeType: "audio/ogg; codecs=opus";
  };
  readonly FLAC: {
    readonly codec: "flac";
    readonly sampleRateHz: 44100;
    readonly channels: 1;
    readonly container: "flac";
    readonly mimeType: "audio/flac";
  };
  readonly WAV: {
    readonly codec: "pcm_s16le";
    readonly sampleRateHz: 44100;
    readonly channels: 1;
    readonly container: "wav";
    readonly mimeType: "audio/wav";
  };
};
/**
 * Default final-output format. MP3 at 192kbps / 44.1kHz / mono — matches what
 * the library has historically produced. Consumers can pick a different preset
 * from {@link OUTPUT_FORMATS} or compose a custom {@link OutputFormat} via
 * {@link BuildAudioOptions.output}.
 */
declare const DEFAULT_OUTPUT_FORMAT: OutputFormat;
//#endregion
//#region src/events.d.ts
/**
 * Lifecycle events emitted by `ttsGenerateFull` during a generation job.
 *
 * Consumers subscribe via {@link BuildAudioOptions.onEvent} and receive a
 * sequence of events as the orchestration progresses. The classic
 * percentage-based `onProgress` callback is still supported alongside this —
 * `onEvent` is the richer surface for consumers who need per-chunk visibility
 * (SSE streams, BullMQ workers reporting structured progress, observability
 * pipelines, latency-per-chunk analysis, etc.).
 *
 * Event ordering for a successful job with N chunks:
 *
 *   parse-complete  (once, after parsing + chunking)
 *   chunk-start     (N times, one per chunk before its upstream call)
 *   chunk-complete  (N times, after each chunk's audio is ready)
 *   stitch-start    (once, before ffmpeg concat begins)
 *   stitch-complete (once, after the final audio is encoded)
 *
 * If the job aborts or fails, the promise rejects — there is no `error`
 * event. Consumers handle failures via `try/catch` or `.catch()`; subscribing
 * to `onEvent` is purely for progress/observability.
 */
type TtsEvent = TtsParseCompleteEvent | TtsChunkStartEvent | TtsChunkCompleteEvent | TtsStitchStartEvent | TtsStitchCompleteEvent;
/**
 * Fires once after the script has been parsed into segments and chunked
 * into provider-sized requests. Lets consumers initialize per-job state
 * (progress bars, expected-duration estimates, etc.) once the total work
 * is known.
 */
interface TtsParseCompleteEvent {
  kind: 'parse-complete';
  /** Number of segments parseScript produced (text + pause segments combined). */
  segments: number;
  /** Number of chunks toChunks produced — equals the number of upstream calls. */
  chunks: number;
}
/** Fires immediately before each `provider.generate(...)` call. */
interface TtsChunkStartEvent {
  kind: 'chunk-start';
  /** Zero-based chunk index. */
  index: number;
  /** Total chunk count for this job. */
  total: number;
}
/** Fires after each `provider.generate(...)` call returns and the chunk's duration is known. */
interface TtsChunkCompleteEvent {
  kind: 'chunk-complete';
  index: number;
  total: number;
  /** Chunk audio duration in seconds (provider-supplied or ffprobe-computed). */
  duration: number;
  /** Chunk audio buffer length in bytes — matches `GenerationResult.size` convention. */
  size: number;
}
/** Fires before `buildFinalAudio` starts assembling the chunks. */
interface TtsStitchStartEvent {
  kind: 'stitch-start';
  /** Number of chunks about to be concatenated. */
  chunks: number;
}
/** Fires after the final audio is encoded and ready to return. */
interface TtsStitchCompleteEvent {
  kind: 'stitch-complete';
  /** Final audio duration in seconds (sum of chunk durations + pauses). */
  duration: number;
  /** Final audio buffer length in bytes — matches `BuildFinalAudioResult.size` convention. */
  size: number;
}
/**
 * Subscriber callback. Always invoked synchronously from the orchestration
 * loop — if the subscriber does expensive work (e.g., HTTP push), wrap it in
 * a fire-and-forget pattern so it doesn't add latency to the pipeline.
 *
 * The return type accepts `void | Promise<void>` so the type system doesn't
 * silently allow `async (e) => { await db.record(e); }` listeners to look
 * correct while their returned Promise is dropped on the floor. We do NOT
 * await the returned Promise — declare it explicitly so callers know the
 * library treats the listener as fire-and-forget either way.
 */
type TtsEventListener = (event: TtsEvent) => void | Promise<void>;
//#endregion
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
/**
 * Per-conductor timeout overrides (all values in milliseconds). Any field left
 * undefined falls back to the corresponding value in
 * {@link DEFAULT_TIMEOUTS}. Defaults are conservative for ElevenLabs at
 * typical chunk sizes; long segments, slow upstream days, or larger chunk
 * budgets may want higher values.
 */
interface TtsTimeouts {
  /** Per-chunk `provider.generate()` wrapping timeout. */
  generate?: number;
  /** Per-chunk ffmpeg transcode (MP3 → intermediate WAV). */
  transcode?: number;
  /** Silence-WAV generation (cached after first build per duration). */
  silenceGen?: number;
  /** Concat-demuxer concatenation (fast path). */
  concat?: number;
  /** Filter-graph concat fallback (slower, re-encodes from scratch). */
  concatFilterFallback?: number;
  /** Final audio encode (codec determined by the resolved OutputFormat). */
  finalEncode?: number;
  /** Outer wrap around the entire `buildFinalAudio` orchestration. */
  stitch?: number;
}
interface TtsRuntimeConfig {
  /** Map of pause labels (e.g. FULL_BREATH) to seconds */
  pauses: Record<string, number>;
  logger?: TtsLogger;
  debug?: DebugSink;
  ffmpeg?: FfmpegConfig;
  /**
   * Per-conductor timeout overrides. Any field left undefined falls back to
   * `DEFAULT_TIMEOUTS`. See {@link TtsTimeouts}.
   */
  timeouts?: TtsTimeouts;
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
  /**
   * AbortSignal that cancels the in-flight generation job. The signal is
   * forwarded to:
   *   - every `provider.generate()` call (which forwards to the upstream SDK)
   *   - every internal ffmpeg / ffprobe spawn (via execa's `signal` option)
   *
   * When aborted, the returned promise rejects with an `AbortError`. Any chunk
   * already in progress completes its current await before unwinding. Useful
   * for BullMQ job cancellation, HTTP request aborts, and similar consumer-side
   * cancellation flows.
   */
  signal?: AbortSignal;
  /**
   * Per-call final-output format. Pick a preset from `OUTPUT_FORMATS` or
   * compose a custom `OutputFormat`. When omitted, falls back to
   * `DEFAULT_OUTPUT_FORMAT` (MP3 192kbps / 44.1kHz / mono — matches what the
   * library has historically produced).
   *
   * The full object is required — `Partial<OutputFormat>` is not accepted
   * because mismatched fields (e.g., Opus codec with MP3 container) silently
   * produce wrong files. To override only some fields of a preset, spread it:
   *
   *   { output: { ...OUTPUT_FORMATS.MP3_192, bitrate: '320k' } }
   */
  output?: OutputFormat;
  /**
   * Subscriber for richer lifecycle events (parse-complete, chunk-start,
   * chunk-complete, stitch-start, stitch-complete). See {@link TtsEvent} for
   * the discriminated-union shape.
   *
   * Coexists with `onProgress` (the percentage-based callback that's still
   * available as a positional arg) — both fire independently. Use `onEvent`
   * when you need per-chunk visibility for SSE streams, BullMQ progress
   * payloads, latency observability, etc. Use `onProgress` if a simple
   * 0-100% summary is enough.
   *
   * The listener is invoked synchronously from the orchestration loop. If
   * the subscriber does expensive work (HTTP push, DB write), wrap it in a
   * fire-and-forget pattern so it doesn't add latency to the pipeline.
   */
  onEvent?: TtsEventListener;
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
interface GenerateCallOptions<TCallOverrides = never> {
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
interface TtsProvider<TCallOverrides = never> {
  readonly id: string;
  readonly caps: ProviderCapabilities;
  generate(chunk: string, options?: GenerateCallOptions<TCallOverrides>): Promise<GenerationResult>;
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
declare function getAudioDuration(audioBuffer: Buffer, ffmpegConfig?: FfmpegConfig, logger?: TtsLogger, signal?: AbortSignal): Promise<number>;
declare function estimateAudioDuration(audioBuffer: Buffer, bitrate?: number): number;
//#endregion
export { type BuildAudioOptions, type BuildFinalAudioResult, type CallOverridesFor, DEFAULT_OUTPUT_FORMAT, DEFAULT_PAUSE_TABLE, DEFAULT_TIMEOUTS, type DebugMeta, type DebugSink, type FfmpegConfig, type GenerateCallOptions, type GenerationResult, OUTPUT_FORMATS, type OutputFormat, type PauseTable, ProcessStage, type ProviderCapabilities, type ProviderOptionsFor, type RegisteredProviderIds, type Segment, TtsAuthenticationError, type TtsChunkCompleteEvent, type TtsChunkStartEvent, TtsConductor, TtsError, type TtsEvent, type TtsEventListener, TtsInvalidInputError, type TtsLogger, type TtsParseCompleteEvent, type TtsProvider, type TtsProviderCallOverridesRegistry, type TtsProviderContext, type TtsProviderFactory, type TtsProviderRegistry, TtsQuotaExceededError, TtsRateLimitError, type TtsRuntimeConfig, type TtsStitchCompleteEvent, type TtsStitchStartEvent, type TtsTimeouts, TtsTransientError, buildFinalAudio, createTtsConductor, estimateAudioDuration, extractPauseMarkers, getAudioDuration, isValidPauseFormat, parsePauseDuration, parseScript, toChunks, ttsGenerateFull, withTimeout };
//# sourceMappingURL=index.d.mts.map