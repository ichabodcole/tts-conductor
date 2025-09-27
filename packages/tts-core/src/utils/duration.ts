import { execa } from 'execa';
import ffmpegPath from 'ffmpeg-static';
import fs from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import type { FfmpegConfig } from '../config';
import type { TtsLogger } from '../config';

async function resolveFfprobeBin(ffmpegConfig?: FfmpegConfig): Promise<string> {
  const candidates = [ffmpegConfig?.ffprobePath, process.env.FFPROBE_PATH, 'ffprobe'].filter(
    Boolean,
  ) as string[];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // continue searching
    }
  }
  return candidates[candidates.length - 1] ?? 'ffprobe';
}

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
      // continue searching
    }
  }

  if (ffmpegPath) {
    try {
      await fs.access(ffmpegPath);
      return ffmpegPath;
    } catch {
      // fall through to default
    }
  }

  return 'ffmpeg';
}

export async function getAudioDuration(
  audioBuffer: Buffer,
  ffmpegConfig?: FfmpegConfig,
  logger?: TtsLogger,
): Promise<number> {
  const tempFile = path.join(tmpdir(), `tts_conductor_temp_${Date.now()}.mp3`);

  try {
    await fs.writeFile(tempFile, audioBuffer);

    const ffprobeBin = await resolveFfprobeBin(ffmpegConfig);
    const ffprobeResult = await execa(
      ffprobeBin,
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        tempFile,
      ],
      { reject: false },
    );
    const probeOut = ffprobeResult.stdout?.toString().trim() ?? '';
    const parsedProbe = parseFloat(probeOut);
    if (!Number.isNaN(parsedProbe) && parsedProbe > 0) {
      return Math.round(parsedProbe * 100) / 100;
    }

    const ffmpegBin = await resolveFfmpegBin(ffmpegConfig);
    const ffmpegResult = await execa(ffmpegBin, ['-i', tempFile], { reject: false });
    const stderr = ffmpegResult.stderr?.toString() ?? '';
    const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (match) {
      const hours = parseInt(match[1] ?? '0', 10);
      const minutes = parseInt(match[2] ?? '0', 10);
      const seconds = parseFloat(match[3] ?? '0');
      const total = hours * 3600 + minutes * 60 + seconds;
      return Math.round(total * 100) / 100;
    }
  } catch (error) {
    logger?.warn?.('Failed to read accurate audio duration, falling back to estimation', error);
  } finally {
    try {
      await fs.unlink(tempFile);
    } catch {
      // ignore cleanup errors
    }
  }

  return estimateAudioDuration(audioBuffer);
}

export function estimateAudioDuration(audioBuffer: Buffer, bitrate = 128): number {
  return Math.round(((audioBuffer.length * 8) / (bitrate * 1000)) * 100) / 100;
}
