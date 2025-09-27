interface TtsRuntimeConfig {
    pauses: Record<string, number>;
    logger?: {
        debug?: (...args: unknown[]) => void;
        info?: (...args: unknown[]) => void;
        warn?: (...args: unknown[]) => void;
        error?: (...args: unknown[]) => void;
    };
}
interface TtsProviderContext {
    config: TtsRuntimeConfig;
}
interface TtsProvider {
    id: string;
    synthesize(ssml: string): Promise<Buffer>;
}
type TtsProviderFactory<Options extends object = Record<string, unknown>> = {
    id: string;
    create: (ctx: TtsProviderContext, options: Options) => TtsProvider;
};
declare class TtsConductor {
    private readonly config;
    private providers;
    constructor(config: TtsRuntimeConfig);
    registerProvider(factory: TtsProviderFactory<Record<string, unknown>>): void;
    hasProvider(id: string): boolean;
    listProviders(): string[];
    createProvider<Options extends object>(id: string, options: Options): TtsProvider;
}
declare function createTtsConductor(config: TtsRuntimeConfig): TtsConductor;

export { TtsConductor, type TtsProvider, type TtsProviderContext, type TtsProviderFactory, type TtsRuntimeConfig, createTtsConductor };
