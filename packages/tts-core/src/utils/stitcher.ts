import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execa } from 'execa';
import type { BuildAudioOptions, FfmpegConfig, TtsLogger, TtsRuntimeConfig } from '../config';
import { ProcessStage } from '../config';
import { DEFAULT_OUTPUT_FORMAT, DEFAULT_TIMEOUTS, INTERMEDIATE_AUDIO } from '../defaults';
import type { Chunk } from './chunker';
import { saveDebugFromFile } from './debug';

// Shorthand for the most-used intermediate-audio values, plus their string forms
// for ffmpeg arg arrays (ffmpeg expects strings on the command line). These are
// NOT user-configurable — see INTERMEDIATE_AUDIO in defaults.ts for the
// rationale (ffmpeg concat-demuxer reliability).
const INTER_SAMPLE_RATE_STR = String(INTERMEDIATE_AUDIO.sampleRateHz);
const INTER_CHANNELS_STR = String(INTERMEDIATE_AUDIO.channels);
const INTER_CODEC = INTERMEDIATE_AUDIO.codec;

// Derived filter-graph values that must stay consistent with the constants
// above. ffmpeg's filter graph uses different vocabulary than CLI args:
//   - channel_layouts wants a layout NAME ('mono' / 'stereo'), not a count
//   - sample_fmts wants a sample-format short name ('s16' for pcm_s16le)
// Centralizing these makes the coupling to INTERMEDIATE_AUDIO explicit.
const INTER_CHANNEL_LAYOUT = INTERMEDIATE_AUDIO.channels === 1 ? 'mono' : 'stereo';
const INTER_SAMPLE_FMT = 's16'; // s16 is the sample_fmt for pcm_s16le

interface AudioPart {
  buffer: Buffer;
  duration: number;
}

const silenceCache = new Map<number, string>();
const MAX_SILENCE_CACHE_SIZE = 50;

async function resolveFfmpegBin(ffmpegConfig?: FfmpegConfig): Promise<string> {
  const candidates = [
    ffmpegConfig?.ffmpegPath,
    process.env.FFMPEG_PATH,
    process.env.FFMPEG_BIN,
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // continue search
    }
  }

  const ffmpegStatic = (await import('ffmpeg-static')).default;
  if (ffmpegStatic) {
    try {
      await fs.access(ffmpegStatic);
      return ffmpegStatic;
    } catch {
      // fall through
    }
  }

  return 'ffmpeg';
}

async function genSilenceWav(
  seconds: number,
  ffmpegConfig?: FfmpegConfig,
  logger?: TtsLogger,
  signal?: AbortSignal,
  timeoutMs: number = DEFAULT_TIMEOUTS.silenceGen,
) {
  if (silenceCache.has(seconds)) return silenceCache.get(seconds)!;

  const out = path.join(tmpdir(), `tts_conductor_silence_${seconds}.wav`);
  const ffmpegBin = await resolveFfmpegBin(ffmpegConfig);

  try {
    await execa(
      ffmpegBin,
      [
        '-f',
        'lavfi',
        '-i',
        `anullsrc=r=${INTERMEDIATE_AUDIO.sampleRateHz}:cl=${INTER_CHANNEL_LAYOUT}`,
        '-t',
        seconds.toString(),
        '-ac',
        INTER_CHANNELS_STR,
        '-ar',
        INTER_SAMPLE_RATE_STR,
        '-c:a',
        INTER_CODEC,
        '-y',
        out,
      ],
      { timeout: timeoutMs, cancelSignal: signal },
    );
  } catch (error) {
    logger?.error?.('Failed to generate silence segment', { seconds, error });
    try {
      await fs.unlink(out);
    } catch {
      // ignore cleanup
    }
    throw error;
  }

  if (silenceCache.size >= MAX_SILENCE_CACHE_SIZE) {
    const oldestKey = silenceCache.keys().next().value as number | undefined;
    if (typeof oldestKey === 'number') {
      const oldestFile = silenceCache.get(oldestKey);
      silenceCache.delete(oldestKey);
      if (oldestFile) {
        fs.unlink(oldestFile).catch(() => undefined);
      }
    }
  }

  silenceCache.set(seconds, out);
  return out;
}

async function concatParts(
  fileList: string[],
  outPath: string,
  ffmpegConfig?: FfmpegConfig,
  logger?: TtsLogger,
  signal?: AbortSignal,
  concatTimeoutMs: number = DEFAULT_TIMEOUTS.concat,
  filterFallbackTimeoutMs: number = DEFAULT_TIMEOUTS.concatFilterFallback,
) {
  const listFile = path.join(tmpdir(), `tts_conductor_concat_${Date.now()}.txt`);

  try {
    await fs.writeFile(
      listFile,
      fileList.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'),
    );

    const ffmpegBin = await resolveFfmpegBin(ffmpegConfig);

    try {
      await execa(
        ffmpegBin,
        [
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          listFile,
          '-c:a',
          INTER_CODEC,
          '-ar',
          INTER_SAMPLE_RATE_STR,
          '-ac',
          INTER_CHANNELS_STR,
          '-y',
          outPath,
        ],
        { timeout: concatTimeoutMs, cancelSignal: signal },
      );
      return;
    } catch (error) {
      // If the abort fired, propagate without trying the filter fallback —
      // the consumer asked us to stop, not to retry differently.
      if (signal?.aborted) throw error;
      logger?.warn?.('Concat demuxer failed, attempting filter fallback', error);
      const args: string[] = [];
      for (const file of fileList) {
        args.push('-i', file);
      }
      const n = fileList.length;
      const filter = `${Array.from({ length: n }, (_, i) => `[${i}:a]`).join('')}concat=n=${n}:v=0:a=1, aformat=sample_fmts=${INTER_SAMPLE_FMT}:sample_rates=${INTERMEDIATE_AUDIO.sampleRateHz}:channel_layouts=${INTER_CHANNEL_LAYOUT} [a]`;
      args.push(
        '-filter_complex',
        filter,
        '-map',
        '[a]',
        '-c:a',
        INTER_CODEC,
        '-ar',
        INTER_SAMPLE_RATE_STR,
        '-ac',
        INTER_CHANNELS_STR,
        '-y',
        outPath,
      );
      await execa(ffmpegBin, args, { timeout: filterFallbackTimeoutMs, cancelSignal: signal });
    }
  } finally {
    try {
      await fs.unlink(listFile);
    } catch {
      logger?.debug?.('Failed to cleanup concat list file', { listFile });
    }
  }
}

export interface BuildFinalAudioResult {
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

export async function buildFinalAudio(
  config: TtsRuntimeConfig,
  chunks: Chunk[],
  audio: AudioPart[],
  fileName?: string,
  options?: BuildAudioOptions,
): Promise<BuildFinalAudioResult> {
  if (chunks.length !== audio.length) {
    throw new Error('chunks and audio arrays must be equal length');
  }

  const logger = config.logger;
  const ffmpegConfig = config.ffmpeg;
  const signal = options?.signal;
  // A7: resolve the output format once. Consumers either pass a full
  // OutputFormat preset (e.g., OUTPUT_FORMATS.OPUS_64) or compose a custom
  // one. No Partial-merge — would silently produce mismatched files.
  const outputFormat = options?.output ?? DEFAULT_OUTPUT_FORMAT;
  // Default filename includes the right container extension so debug sinks
  // and consumer disk-writes get the right suffix. Consumer-supplied
  // fileName is honored verbatim (consumer's responsibility to match).
  const resolvedFileName = fileName ?? `tts_${Date.now()}.${outputFormat.container}`;
  // Resolve timeouts once at the orchestration boundary so all helpers
  // receive primitive numbers, not the optional config shape.
  const timeouts = { ...DEFAULT_TIMEOUTS, ...(config.timeouts ?? {}) };
  const tmp = tmpdir();
  const partFiles: string[] = [];
  const tempFilesToCleanup: string[] = [];

  try {
    signal?.throwIfAborted();
    const ffmpegBin = await resolveFfmpegBin(ffmpegConfig);
    for (let i = 0; i < audio.length; i++) {
      signal?.throwIfAborted();

      const speechMp3 = path.join(tmp, `tts_chunk_${i}_${Date.now()}.mp3`);
      const speechWav = path.join(tmp, `tts_chunk_${i}_${Date.now()}.wav`);

      await fs.writeFile(speechMp3, audio[i]?.buffer ?? Buffer.alloc(0));
      tempFilesToCleanup.push(speechMp3);

      await execa(
        ffmpegBin,
        [
          '-i',
          speechMp3,
          '-ar',
          INTER_SAMPLE_RATE_STR,
          '-ac',
          INTER_CHANNELS_STR,
          '-c:a',
          INTER_CODEC,
          '-y',
          speechWav,
        ],
        { timeout: timeouts.transcode, cancelSignal: signal },
      );

      partFiles.push(speechWav);
      tempFilesToCleanup.push(speechWav);

      const chunk = chunks[i];
      const pauseSeconds = chunk?.postPause ?? 0;
      if (pauseSeconds > 0) {
        const silenceFile = await genSilenceWav(
          pauseSeconds,
          ffmpegConfig,
          logger,
          signal,
          timeouts.silenceGen,
        );
        partFiles.push(silenceFile);
      }
    }

    signal?.throwIfAborted();
    const outWavPath = path.join(tmp, `tts_concat_${Date.now()}.wav`);
    tempFilesToCleanup.push(outWavPath);
    await concatParts(
      partFiles,
      outWavPath,
      ffmpegConfig,
      logger,
      signal,
      timeouts.concat,
      timeouts.concatFilterFallback,
    );

    const outPath = path.join(tmp, resolvedFileName);
    tempFilesToCleanup.push(outPath);

    // Build the final-encode args from the resolved OutputFormat. `-b:a` is
    // only emitted for lossy codecs that declared a bitrate; lossless codecs
    // (FLAC, PCM) omit the field intentionally — supplying it would be
    // silently ignored by ffmpeg.
    const finalEncodeArgs = [
      '-i',
      outWavPath,
      '-c:a',
      outputFormat.codec,
      '-ar',
      String(outputFormat.sampleRateHz),
      '-ac',
      String(outputFormat.channels),
    ];
    if (outputFormat.bitrate) {
      finalEncodeArgs.push('-b:a', outputFormat.bitrate);
    }
    finalEncodeArgs.push('-y', outPath);

    await execa(ffmpegBin, finalEncodeArgs, {
      timeout: timeouts.finalEncode,
      cancelSignal: signal,
    });

    await saveDebugFromFile(config, outPath, {
      fileName: `final_${resolvedFileName}`,
      jobId: options?.debugJobId,
      stage: ProcessStage.Final,
    });

    const buf = await fs.readFile(outPath);
    const durationSec = audio.reduce((sum, part, idx) => {
      const chunk = chunks[idx];
      const pause = chunk?.postPause ?? 0;
      return sum + part.duration + pause;
    }, 0);

    const result: BuildFinalAudioResult = {
      audio: buf,
      base64Data: buf.toString('base64'),
      mimeType: outputFormat.mimeType,
      size: buf.length,
      duration: durationSec,
    };

    await cleanupTempFiles(tempFilesToCleanup);
    return result;
  } catch (error) {
    await cleanupTempFiles(tempFilesToCleanup);
    throw error;
  }
}

async function cleanupTempFiles(filePaths: string[]): Promise<void> {
  await Promise.allSettled(
    filePaths.map(async (filePath) => {
      try {
        await fs.unlink(filePath);
      } catch {
        // ignore
      }
    }),
  );
}
