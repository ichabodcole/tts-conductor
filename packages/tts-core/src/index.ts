export type {
  TtsRuntimeConfig,
  TtsLogger,
  DebugSink,
  DebugMeta,
  FfmpegConfig,
  BuildAudioOptions,
} from './config';
export { createTtsConductor, TtsConductor } from './conductor';
export type { TtsProviderFactory, TtsProviderContext } from './factory';
export type { TtsProvider, ProviderCapabilities, GenerationResult } from './provider';
export { ttsGenerateFull, withTimeout } from './operations';
export type { BuildFinalAudioResult } from './utils/stitcher';
export type { Segment } from './utils/segmenter';
export type { PauseTable } from './utils/pause';
export { parsePauseDuration, extractPauseMarkers, isValidPauseFormat } from './utils/pause';
export { parseScript } from './utils/segmenter';
export { toChunks } from './utils/chunker';
export { getAudioDuration, estimateAudioDuration } from './utils/duration';
export { buildFinalAudio } from './utils/stitcher';
export { DEFAULT_PAUSE_TABLE } from './defaults';
