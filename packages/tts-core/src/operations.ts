import type { BuildAudioOptions, TtsRuntimeConfig } from './config';
import { ProcessStage } from './config';
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
      reject(new Error(`[tts] Timeout after ${ms}ms during ${label}`));
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

  const segments = parseScript(rawText, config.pauses, logger);
  logger?.info?.('[tts] Parsed segments', { count: segments.length });

  const chunks = toChunks(segments, provider.caps, logger);
  logger?.info?.('[tts] Generated chunks', { count: chunks.length });

  const audioParts: { buffer: Buffer; duration: number }[] = [];
  let done = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i] as Chunk;
    const input = `<speak>${chunk.ssml}</speak>`;
    logger?.debug?.('[tts] Generating chunk', {
      provider: providerId,
      index: i,
      postPause: chunk.postPause,
    });

    onProgress?.(Math.min(10, Math.round(((i + 1) / chunks.length) * 10)));

    const res = await withTimeout(provider.generate(input), 60000, `provider.generate chunk ${i}`);

    // Trust provider duration if supplied, otherwise compute it:
    const duration = res.duration ?? (await getAudioDuration(res.audio, config.ffmpeg, logger));

    audioParts.push({ buffer: res.audio, duration });
    done++;

    await saveDebugFromBuffer(config, res.audio, {
      fileName: `raw_${providerId}_${i}_${Date.now()}.mp3`,
      jobId: options?.debugJobId,
      stage: ProcessStage.Raw,
    });

    const chunkProgress = Math.round((done / chunks.length) * 80);
    onProgress?.(chunkProgress);
  }

  onProgress?.(80);
  const final = await withTimeout(
    buildFinalAudio(config, chunks, audioParts, undefined, options),
    45000,
    'stitcher.buildFinalAudio',
  );
  onProgress?.(100);

  return final;
}
