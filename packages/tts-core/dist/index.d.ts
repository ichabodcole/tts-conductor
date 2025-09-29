interface TtsLogger {
    debug?: (...args: unknown[]) => void;
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
}
interface DebugMeta {
    fileName: string;
    jobId?: string;
    stage?: 'raw' | 'final' | string;
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
interface TtsProviderRegistry {
}
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

declare const DEFAULT_PAUSE_TABLE: PauseTable;

type Segment = {
    kind: 'text';
    value: string;
} | {
    kind: 'pause';
    label: string;
    seconds: number;
};
declare function parseScript(input: string, table: PauseTable, logger?: TtsLogger): Segment[];

interface Chunk {
    ssml: string;
    postPause: number;
}
declare function toChunks(segments: Segment[], caps: ProviderCapabilities, logger?: TtsLogger): Chunk[];

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

declare function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T>;
declare function ttsGenerateFull(rawText: string, provider: TtsProvider, config: TtsRuntimeConfig, onProgress?: (percent: number) => void, options?: BuildAudioOptions): Promise<BuildFinalAudioResult>;

declare function getAudioDuration(audioBuffer: Buffer, ffmpegConfig?: FfmpegConfig, logger?: TtsLogger): Promise<number>;
declare function estimateAudioDuration(audioBuffer: Buffer, bitrate?: number): number;

export { type BuildAudioOptions, type BuildFinalAudioResult, DEFAULT_PAUSE_TABLE, type DebugMeta, type DebugSink, type FfmpegConfig, type GenerationResult, type PauseTable, type ProviderCapabilities, type ProviderOptionsFor, type RegisteredProviderIds, type Segment, TtsConductor, type TtsLogger, type TtsProvider, type TtsProviderContext, type TtsProviderFactory, type TtsProviderRegistry, type TtsRuntimeConfig, buildFinalAudio, createTtsConductor, estimateAudioDuration, extractPauseMarkers, getAudioDuration, isValidPauseFormat, parsePauseDuration, parseScript, toChunks, ttsGenerateFull, withTimeout };
