import type { DebugMeta, TtsRuntimeConfig } from '../config';
import { ProcessStage } from '../config';

export interface DebugOptions {
  fileName?: string;
  jobId?: string;
  stage?: DebugMeta['stage'];
}

function buildMeta(options: DebugOptions): DebugMeta {
  return {
    fileName: options.fileName ?? `tts_${Date.now()}.mp3`,
    jobId: options.jobId,
    stage: options.stage ?? ProcessStage.Unknown, // Provide default if not specified
  };
}

export async function saveDebugFromBuffer(
  config: TtsRuntimeConfig,
  buffer: Buffer,
  options: DebugOptions = {},
): Promise<void> {
  const sink = config.debug;
  if (!sink?.saveBuffer) return;
  const meta = buildMeta(options);
  await sink.saveBuffer(buffer, meta);
}

export async function saveDebugFromFile(
  config: TtsRuntimeConfig,
  path: string,
  options: DebugOptions = {},
): Promise<void> {
  const sink = config.debug;
  if (!sink?.saveFile) return;
  const meta = buildMeta(options);
  await sink.saveFile(path, meta);
}
