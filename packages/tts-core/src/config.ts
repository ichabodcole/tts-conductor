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

export interface TtsRuntimeConfig {
  /** Map of pause labels (e.g. FULL_BREATH) to seconds */
  pauses: Record<string, number>;
  logger?: TtsLogger;
  debug?: DebugSink;
  ffmpeg?: FfmpegConfig;
}

export interface BuildAudioOptions {
  debugJobId?: string;
}
