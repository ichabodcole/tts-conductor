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
    mimeType: string;
    duration: number;
    size: number;
}
interface TtsProvider {
    readonly caps: ProviderCapabilities;
    generate(chunk: string): Promise<GenerationResult>;
}

interface TtsProviderContext {
    config: TtsRuntimeConfig;
}
interface TtsProviderFactory<Options extends object = Record<string, unknown>> {
    id: string;
    create: (ctx: TtsProviderContext, options: Options) => TtsProvider;
}

declare class TtsConductor {
    private readonly config;
    private providers;
    constructor(config: TtsRuntimeConfig);
    get runtimeConfig(): TtsRuntimeConfig;
    registerProvider(factory: TtsProviderFactory<object>): void;
    hasProvider(id: string): boolean;
    listProviders(): string[];
    createProvider<Options extends object>(id: string, options: Options): TtsProvider;
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

declare const DEFAULT_PAUSE_TABLE: PauseTable;

export { type BuildAudioOptions, type BuildFinalAudioResult, DEFAULT_PAUSE_TABLE, type DebugMeta, type DebugSink, type FfmpegConfig, type GenerationResult, type PauseTable, type ProviderCapabilities, type Segment, TtsConductor, type TtsLogger, type TtsProvider, type TtsProviderContext, type TtsProviderFactory, type TtsRuntimeConfig, buildFinalAudio, createTtsConductor, estimateAudioDuration, extractPauseMarkers, getAudioDuration, isValidPauseFormat, parsePauseDuration, parseScript, toChunks, ttsGenerateFull, withTimeout };
