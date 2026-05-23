import type { OutputFormat } from './defaults';
import type { TtsEventListener } from './events';

export enum ProcessStage {
  /** Individual audio chunks from providers */
  Raw = 'raw',
  /** Final assembled audio after stitching */
  Final = 'final',
  /** Fallback stage when not specified by caller */
  Unknown = 'unknown',
}

export interface TtsLogger {
  debug?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

export interface DebugMeta {
  fileName: string; // Always provided by core package
  jobId?: string; // Optional, provided by consuming projects
  stage: ProcessStage | string; // Always provided by core package
  [key: string]: unknown; // Allow arbitrary additional metadata
}

export interface DebugSink {
  saveBuffer?: (buffer: Buffer, meta: DebugMeta) => Promise<void> | void;
  saveFile?: (path: string, meta: DebugMeta) => Promise<void> | void;
}

export interface FfmpegConfig {
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
export interface TtsTimeouts {
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

export interface TtsRuntimeConfig {
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

export interface BuildAudioOptions {
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
