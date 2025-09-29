export { TtsConductor, createTtsConductor } from './conductor';
export { ProcessStage } from './config';
export type {
  BuildAudioOptions,
  DebugMeta,
  DebugSink,
  FfmpegConfig,
  TtsLogger,
  TtsRuntimeConfig,
} from './config';
export { DEFAULT_PAUSE_TABLE } from './defaults';
export type {
  ProviderOptionsFor,
  RegisteredProviderIds,
  TtsProviderContext,
  TtsProviderFactory,
  TtsProviderRegistry,
} from './factory';
export { ttsGenerateFull, withTimeout } from './operations';
export type { GenerationResult, ProviderCapabilities, TtsProvider } from './provider';
export { toChunks } from './utils/chunker';
export { estimateAudioDuration, getAudioDuration } from './utils/duration';
export { extractPauseMarkers, isValidPauseFormat, parsePauseDuration } from './utils/pause';
export type { PauseTable } from './utils/pause';
export { parseScript } from './utils/segmenter';
export type { Segment } from './utils/segmenter';
export { buildFinalAudio } from './utils/stitcher';
export type { BuildFinalAudioResult } from './utils/stitcher';
