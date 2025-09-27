import fs from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import { execa } from 'execa';
import type { BuildAudioOptions, TtsRuntimeConfig, TtsLogger } from '../config';
import type { Chunk } from './chunker';
import { saveDebugFromFile } from './debug';
import type { FfmpegConfig } from '../config';

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

async function genSilenceWav(seconds: number, ffmpegConfig?: FfmpegConfig, logger?: TtsLogger) {
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
        `anullsrc=r=44100:cl=mono`,
        '-t',
        seconds.toString(),
        '-ac',
        '1',
        '-ar',
        '44100',
        '-c:a',
        'pcm_s16le',
        '-y',
        out,
      ],
      { timeout: 30000 },
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
          'pcm_s16le',
          '-ar',
          '44100',
          '-ac',
          '1',
          '-y',
          outPath,
        ],
        { timeout: 45000 },
      );
      return;
    } catch (error) {
      logger?.warn?.('Concat demuxer failed, attempting filter fallback', error);
      const args: string[] = [];
      for (const file of fileList) {
        args.push('-i', file);
      }
      const n = fileList.length;
      const filter = `${Array.from({ length: n }, (_, i) => `[${i}:a]`).join('')}concat=n=${n}:v=0:a=1, aformat=sample_fmts=s16:sample_rates=44100:channel_layouts=mono [a]`;
      args.push(
        '-filter_complex',
        filter,
        '-map',
        '[a]',
        '-c:a',
        'pcm_s16le',
        '-ar',
        '44100',
        '-ac',
        '1',
        '-y',
        outPath,
      );
      await execa(ffmpegBin, args, { timeout: 60000 });
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
  base64Data: string;
  mimeType: string;
  size: number;
  duration: number;
}

export async function buildFinalAudio(
  config: TtsRuntimeConfig,
  chunks: Chunk[],
  audio: AudioPart[],
  fileName = `tts_${Date.now()}.mp3`,
  options?: BuildAudioOptions,
): Promise<BuildFinalAudioResult> {
  if (chunks.length !== audio.length) {
    throw new Error('chunks and audio arrays must be equal length');
  }

  const logger = config.logger;
  const ffmpegConfig = config.ffmpeg;
  const tmp = tmpdir();
  const partFiles: string[] = [];
  const tempFilesToCleanup: string[] = [];

  try {
    const ffmpegBin = await resolveFfmpegBin(ffmpegConfig);
    for (let i = 0; i < audio.length; i++) {
      const speechMp3 = path.join(tmp, `tts_chunk_${i}_${Date.now()}.mp3`);
      const speechWav = path.join(tmp, `tts_chunk_${i}_${Date.now()}.wav`);

      await fs.writeFile(speechMp3, audio[i]?.buffer ?? Buffer.alloc(0));
      tempFilesToCleanup.push(speechMp3);

      await execa(
        ffmpegBin,
        ['-i', speechMp3, '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', '-y', speechWav],
        { timeout: 30000 },
      );

      partFiles.push(speechWav);
      tempFilesToCleanup.push(speechWav);

      const chunk = chunks[i];
      const pauseSeconds = chunk?.postPause ?? 0;
      if (pauseSeconds > 0) {
        const silenceFile = await genSilenceWav(pauseSeconds, ffmpegConfig, logger);
        partFiles.push(silenceFile);
      }
    }

    const outWavPath = path.join(tmp, `tts_concat_${Date.now()}.wav`);
    tempFilesToCleanup.push(outWavPath);
    await concatParts(partFiles, outWavPath, ffmpegConfig, logger);

    const outPath = path.join(tmp, fileName);
    tempFilesToCleanup.push(outPath);

    await execa(
      ffmpegBin,
      ['-i', outWavPath, '-c:a', 'libmp3lame', '-ar', '44100', '-b:a', '192k', '-y', outPath],
      { timeout: 45000 },
    );

    await saveDebugFromFile(config, outPath, {
      fileName: `final_${fileName}`,
      jobId: options?.debugJobId,
      stage: 'final',
    });

    const buf = await fs.readFile(outPath);
    const durationSec = audio.reduce((sum, part, idx) => {
      const chunk = chunks[idx];
      const pause = chunk?.postPause ?? 0;
      return sum + part.duration + pause;
    }, 0);

    const result: BuildFinalAudioResult = {
      base64Data: buf.toString('base64'),
      mimeType: 'audio/mpeg',
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
