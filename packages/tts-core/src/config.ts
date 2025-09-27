export interface TtsLogger {
  debug?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}

export interface DebugMeta {
  fileName: string;
  jobId?: string;
  stage?: 'raw' | 'final' | string;
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
