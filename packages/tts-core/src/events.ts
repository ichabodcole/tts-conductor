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
export type TtsEvent =
  | TtsParseCompleteEvent
  | TtsChunkStartEvent
  | TtsChunkCompleteEvent
  | TtsStitchStartEvent
  | TtsStitchCompleteEvent;

/**
 * Fires once after the script has been parsed into segments and chunked
 * into provider-sized requests. Lets consumers initialize per-job state
 * (progress bars, expected-duration estimates, etc.) once the total work
 * is known.
 */
export interface TtsParseCompleteEvent {
  kind: 'parse-complete';
  /** Number of segments parseScript produced (text + pause segments combined). */
  segments: number;
  /** Number of chunks toChunks produced — equals the number of upstream calls. */
  chunks: number;
}

/** Fires immediately before each `provider.generate(...)` call. */
export interface TtsChunkStartEvent {
  kind: 'chunk-start';
  /** Zero-based chunk index. */
  index: number;
  /** Total chunk count for this job. */
  total: number;
}

/** Fires after each `provider.generate(...)` call returns and the chunk's duration is known. */
export interface TtsChunkCompleteEvent {
  kind: 'chunk-complete';
  index: number;
  total: number;
  /** Chunk audio duration in seconds (provider-supplied or ffprobe-computed). */
  duration: number;
  /** Chunk audio buffer length in bytes — matches `GenerationResult.size` convention. */
  size: number;
  /**
   * Opaque provider metadata for this chunk, forwarded verbatim from
   * `GenerationResult.providerMeta`. Present only when the provider supplied it
   * (e.g., a fal `request_id`); omitted otherwise. Lets consumers attribute
   * per-chunk detail incrementally as the job streams, without waiting for the
   * aggregated `BuildFinalAudioResult.providerMeta` list.
   */
  providerMeta?: Record<string, unknown>;
}

/** Fires before `buildFinalAudio` starts assembling the chunks. */
export interface TtsStitchStartEvent {
  kind: 'stitch-start';
  /** Number of chunks about to be concatenated. */
  chunks: number;
}

/** Fires after the final audio is encoded and ready to return. */
export interface TtsStitchCompleteEvent {
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
export type TtsEventListener = (event: TtsEvent) => void | Promise<void>;
