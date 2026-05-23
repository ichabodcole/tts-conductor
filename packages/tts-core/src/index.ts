export { createTtsConductor, TtsConductor } from './conductor';
export type {
  BuildAudioOptions,
  DebugMeta,
  DebugSink,
  FfmpegConfig,
  TtsLogger,
  TtsRuntimeConfig,
} from './config';
export { ProcessStage } from './config';
export { DEFAULT_PAUSE_TABLE } from './defaults';
export {
  TtsAuthenticationError,
  TtsError,
  TtsInvalidInputError,
  TtsQuotaExceededError,
  TtsRateLimitError,
  TtsTransientError,
} from './errors';
export type {
  CallOverridesFor,
  ProviderOptionsFor,
  RegisteredProviderIds,
  TtsProviderCallOverridesRegistry,
  TtsProviderContext,
  TtsProviderFactory,
  TtsProviderRegistry,
} from './factory';
export { ttsGenerateFull, withTimeout } from './operations';
export type {
  GenerateCallOptions,
  GenerationResult,
  ProviderCapabilities,
  TtsProvider,
} from './provider';
export { toChunks } from './utils/chunker';
export { estimateAudioDuration, getAudioDuration } from './utils/duration';
export type { PauseTable } from './utils/pause';
export { extractPauseMarkers, isValidPauseFormat, parsePauseDuration } from './utils/pause';
export type { Segment } from './utils/segmenter';
export { parseScript } from './utils/segmenter';
export type { BuildFinalAudioResult } from './utils/stitcher';
export { buildFinalAudio } from './utils/stitcher';
