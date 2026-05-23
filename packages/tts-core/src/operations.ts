import type { BuildAudioOptions, TtsRuntimeConfig } from './config';
import { ProcessStage } from './config';
import { DEFAULT_TIMEOUTS } from './defaults';
import { TtsTransientError } from './errors';
import type { TtsProvider } from './provider';
import type { Chunk } from './utils/chunker';
import { toChunks } from './utils/chunker';
import { saveDebugFromBuffer } from './utils/debug';
import { getAudioDuration } from './utils/duration';
import { parseScript } from './utils/segmenter';
import type { BuildFinalAudioResult } from './utils/stitcher';
import { buildFinalAudio } from './utils/stitcher';

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TtsTransientError(`[tts] Timeout after ${ms}ms during ${label}`));
    }, ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

export async function ttsGenerateFull(
  rawText: string,
  provider: TtsProvider,
  config: TtsRuntimeConfig,
  onProgress?: (percent: number) => void,
  options?: BuildAudioOptions,
): Promise<BuildFinalAudioResult> {
  const logger = config.logger;
  const providerId = provider.id;
  // A3: signal threads through every provider.generate, every ffprobe call,
  // and every ffmpeg spawn in buildFinalAudio. The check is centralized so
  // we can bail before kicking off expensive work when the caller has already
  // cancelled (e.g., BullMQ job killed before we started).
  const signal = options?.signal;
  signal?.throwIfAborted();

  // Resolve timeouts once for the orchestration scope so the rest of the
  // function reads primitive numbers, matching the pattern used inside
  // buildFinalAudio. This avoids two timeout-resolution styles drifting
  // apart as more keys are added (config-sweep convention).
  const timeouts = { ...DEFAULT_TIMEOUTS, ...(config.timeouts ?? {}) };

  // A8: richer lifecycle events coexist with the legacy onProgress percentage.
  // Both fire independently — onProgress for the simple 0-100% case, onEvent
  // for SSE / observability consumers who need per-chunk structured data.
  const onEvent = options?.onEvent;

  // Per-call pause table overrides the runtime-config pause table when supplied
  // (A1: multi-tenant pause vocabulary without per-tenant conductors).
  const effectivePauses = options?.pauses ?? config.pauses;
  const segments = parseScript(rawText, effectivePauses, logger);
  logger?.info?.('[tts] Parsed segments', { count: segments.length });

  // V6: clamp pause durations against the configured upper bound before any
  // downstream code uses them. Protects against adversarial input that would
  // otherwise request arbitrary silence (e.g., `[PAUSE:99999s]` → ~27h of
  // silence per chunk). No clamp when maxPauseSeconds is unset.
  const maxPause = config.maxPauseSeconds;
  if (maxPause !== undefined && maxPause > 0) {
    for (const segment of segments) {
      if (segment.kind === 'pause' && segment.seconds > maxPause) {
        logger?.warn?.('[tts] Pause duration clamped', {
          label: segment.label,
          requested: segment.seconds,
          clampedTo: maxPause,
        });
        segment.seconds = maxPause;
      }
    }
  }

  // Per-call maxCharsPerRequest overrides the provider's declared cap when supplied
  // (A5: latency / progress-granularity tuning without forking the provider).
  // Non-positive values are treated as "no override" — passing 0 or a negative
  // number would otherwise break chunking (every character becomes its own chunk
  // or worse). Validating at the boundary keeps the rest of the pipeline simple.
  const callCap = options?.maxCharsPerRequest;
  const effectiveCaps =
    callCap !== undefined && callCap > 0
      ? { ...provider.caps, maxCharsPerRequest: callCap }
      : provider.caps;
  const chunks = toChunks(segments, effectiveCaps, logger);
  logger?.info?.('[tts] Generated chunks', { count: chunks.length });

  // D8a: emit a 0% tick before parse-complete so dual-subscriber consumers
  // (onProgress + onEvent) see a matching progress signal at every event
  // boundary — keeps the two channels symmetric. Without this, parse-complete
  // is the only event with no corresponding onProgress emission.
  onProgress?.(0);
  onEvent?.({ kind: 'parse-complete', segments: segments.length, chunks: chunks.length });

  const audioParts: { buffer: Buffer; duration: number }[] = [];
  let done = 0;

  for (let i = 0; i < chunks.length; i++) {
    // Re-check between chunks so an abort that lands mid-pipeline bails before
    // kicking off the next upstream call instead of waiting for the in-flight
    // chunk's withTimeout to win the race.
    signal?.throwIfAborted();

    const chunk = chunks[i] as Chunk;
    const input = `<speak>${chunk.ssml}</speak>`;
    logger?.debug?.('[tts] Generating chunk', {
      provider: providerId,
      index: i,
      postPause: chunk.postPause,
    });

    // Fire chunk-start before onProgress so dual-subscriber consumers see
    // the structured event before the percentage advances. Matches the
    // post-chunk side which does onProgress → chunk-complete in order.
    onEvent?.({ kind: 'chunk-start', index: i, total: chunks.length });
    onProgress?.(Math.min(10, Math.round(((i + 1) / chunks.length) * 10)));

    const res = await withTimeout(
      provider.generate(input, { signal }),
      timeouts.generate,
      `provider.generate chunk ${i}`,
    );

    // Trust provider duration if supplied, otherwise compute it:
    const duration =
      res.duration ?? (await getAudioDuration(res.audio, config.ffmpeg, logger, signal));

    audioParts.push({ buffer: res.audio, duration });
    done++;

    await saveDebugFromBuffer(config, res.audio, {
      fileName: `raw_${providerId}_${i}_${Date.now()}.mp3`,
      jobId: options?.debugJobId,
      stage: ProcessStage.Raw,
    });

    const chunkProgress = Math.round((done / chunks.length) * 80);
    onProgress?.(chunkProgress);
    onEvent?.({
      kind: 'chunk-complete',
      index: i,
      total: chunks.length,
      duration,
      size: res.audio.length,
    });
  }

  onProgress?.(80);
  onEvent?.({ kind: 'stitch-start', chunks: chunks.length });
  const final = await withTimeout(
    buildFinalAudio(config, chunks, audioParts, undefined, options),
    timeouts.stitch,
    'stitcher.buildFinalAudio',
  );
  onProgress?.(100);
  onEvent?.({ kind: 'stitch-complete', duration: final.duration, size: final.size });

  return final;
}
