//#region src/config.d.ts
declare enum ProcessStage {
  /** Individual audio chunks from providers */
  Raw = "raw",
  /** Final assembled audio after stitching */
  Final = "final",
  /** Fallback stage when not specified by caller */
  Unknown = "unknown",
}
interface TtsLogger {
  debug?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
}
interface DebugMeta {
  fileName: string;
  jobId?: string;
  stage: ProcessStage | string;
  [key: string]: unknown;
}
interface DebugSink {
  saveBuffer?: (buffer: Buffer, meta: DebugMeta) => Promise<void> | void;
  saveFile?: (path: string, meta: DebugMeta) => Promise<void> | void;
}
interface FfmpegConfig {
  ffmpegPath?: string;
  ffprobePath?: string;
}
interface TtsRuntimeConfig {
  /** Map of pause labels (e.g. FULL_BREATH) to seconds */
  pauses: Record<string, number>;
  logger?: TtsLogger;
  debug?: DebugSink;
  ffmpeg?: FfmpegConfig;
}
interface BuildAudioOptions {
  debugJobId?: string;
}
//#endregion
//#region src/provider.d.ts
interface ProviderCapabilities {
  /** null if provider cannot inline breaks */
  maxInlineBreakSeconds: number | null;
  maxCharsPerRequest?: number;
  renderInlineBreak?: (seconds: number) => string;
}
interface GenerationResult {
  audio: Buffer;
  mimeType?: string;
  duration?: number;
  size?: number;
}
interface TtsProvider {
  readonly id: string;
  readonly caps: ProviderCapabilities;
  generate(chunk: string): Promise<GenerationResult>;
}
//#endregion
//#region src/factory.d.ts
interface TtsProviderContext {
  config: TtsRuntimeConfig;
  id: string;
}
/**
 * Provider registry interface that can be extended by provider packages
 * to register their specific option types.
 *
 * Example usage in a provider package:
 *
 * declare module '@tts-conductor/core' {
 *   interface TtsProviderRegistry {
 *     '11labs': ElevenLabsProviderOptions;
 *     'my-provider': MyProviderOptions;
 *   }
 * }
 */
interface TtsProviderRegistry {}
/**
 * Type helper to get the options type for a specific provider ID
 */
type ProviderOptionsFor<T extends keyof TtsProviderRegistry> = TtsProviderRegistry[T];
/**
 * Type helper to get all registered provider IDs
 */
type RegisteredProviderIds = keyof TtsProviderRegistry;
/**
 * Type-safe factory interface for registered providers.
 * All providers must be registered in TtsProviderRegistry via module augmentation.
 */
interface TtsProviderFactory<T extends RegisteredProviderIds> {
  id: T;
  create: (ctx: TtsProviderContext, options: ProviderOptionsFor<T>) => TtsProvider;
}
//#endregion
//#region src/utils/pause.d.ts
type PauseTable = Record<string, number>;
/**
 * Parse pause duration from various pause formats
 * Supports patterns like:
 *   [PAUSE:LABEL]
 *   [PAUSE:LABEL:Nx]
 *   [PAUSE:LABEL:Ns]
 *   [PAUSE:Ns]
 */
declare function parsePauseDuration(pauseMatch: string, table: PauseTable): number;
declare function isValidPauseFormat(input: string): boolean;
declare function extractPauseMarkers(text: string): string[];
//#endregion
//#region src/utils/segmenter.d.ts
type Segment = {
  kind: 'text';
  value: string;
} | {
  kind: 'pause';
  label: string;
  seconds: number;
};
declare function parseScript(input: string, table: PauseTable, logger?: TtsLogger): Segment[];
//#endregion
//#region src/utils/chunker.d.ts
interface Chunk {
  ssml: string;
  postPause: number;
}
declare function toChunks(segments: Segment[], caps: ProviderCapabilities, logger?: TtsLogger): Chunk[];
//#endregion
//#region src/utils/stitcher.d.ts
interface AudioPart {
  buffer: Buffer;
  duration: number;
}
interface BuildFinalAudioResult {
  base64Data: string;
  mimeType: string;
  size: number;
  duration: number;
}
declare function buildFinalAudio(config: TtsRuntimeConfig, chunks: Chunk[], audio: AudioPart[], fileName?: string, options?: BuildAudioOptions): Promise<BuildFinalAudioResult>;
//#endregion
//#region src/conductor.d.ts
declare class TtsConductor {
  private readonly config;
  private providers;
  constructor(config: TtsRuntimeConfig);
  get runtimeConfig(): TtsRuntimeConfig;
  /**
   * Register a provider factory with type-safe options.
   * Provider must be registered in the TtsProviderRegistry via module augmentation.
   */
  registerProvider<T extends RegisteredProviderIds>(factory: TtsProviderFactory<T>): T;
  hasProvider(id: string): boolean;
  listProviders(): string[];
  /**
   * Create a provider instance with type-safe options.
   * Provider must be registered in the TtsProviderRegistry via module augmentation.
   */
  createProvider<T extends RegisteredProviderIds>(id: T, options: ProviderOptionsFor<T>): TtsProvider;
  generateFull(rawText: string, provider: TtsProvider, onProgress?: (percent: number) => void, options?: BuildAudioOptions): Promise<BuildFinalAudioResult>;
}
declare function createTtsConductor(config: TtsRuntimeConfig): TtsConductor;
//#endregion
//#region src/defaults.d.ts
declare const DEFAULT_PAUSE_TABLE: PauseTable;
//#endregion
//#region src/operations.d.ts
declare function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T>;
declare function ttsGenerateFull(rawText: string, provider: TtsProvider, config: TtsRuntimeConfig, onProgress?: (percent: number) => void, options?: BuildAudioOptions): Promise<BuildFinalAudioResult>;
//#endregion
//#region src/utils/duration.d.ts
declare function getAudioDuration(audioBuffer: Buffer, ffmpegConfig?: FfmpegConfig, logger?: TtsLogger): Promise<number>;
declare function estimateAudioDuration(audioBuffer: Buffer, bitrate?: number): number;
//#endregion
export { type BuildAudioOptions, type BuildFinalAudioResult, DEFAULT_PAUSE_TABLE, type DebugMeta, type DebugSink, type FfmpegConfig, type GenerationResult, type PauseTable, ProcessStage, type ProviderCapabilities, type ProviderOptionsFor, type RegisteredProviderIds, type Segment, TtsConductor, type TtsLogger, type TtsProvider, type TtsProviderContext, type TtsProviderFactory, type TtsProviderRegistry, type TtsRuntimeConfig, buildFinalAudio, createTtsConductor, estimateAudioDuration, extractPauseMarkers, getAudioDuration, isValidPauseFormat, parsePauseDuration, parseScript, toChunks, ttsGenerateFull, withTimeout };
//# sourceMappingURL=index.d.mts.map