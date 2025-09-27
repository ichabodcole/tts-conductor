export interface TtsRuntimeConfig {
  pauses: Record<string, number>;
  logger?: {
    debug?: (...args: unknown[]) => void;
    info?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error?: (...args: unknown[]) => void;
  };
}

export interface TtsProviderContext {
  config: TtsRuntimeConfig;
}

export interface TtsProvider {
  id: string;
  synthesize(ssml: string): Promise<Buffer>;
}

export type TtsProviderFactory<Options extends object = Record<string, unknown>> = {
  id: string;
  create: (ctx: TtsProviderContext, options: Options) => TtsProvider;
};

export class TtsConductor {
  private providers = new Map<string, TtsProviderFactory<Record<string, unknown>>>();

  constructor(private readonly config: TtsRuntimeConfig) {}

  registerProvider(factory: TtsProviderFactory<Record<string, unknown>>) {
    this.providers.set(factory.id, factory);
    this.config.logger?.debug?.('Registered provider', factory.id);
  }

  hasProvider(id: string): boolean {
    return this.providers.has(id);
  }

  listProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  createProvider<Options extends object>(id: string, options: Options) {
    const factory = this.providers.get(id) as TtsProviderFactory<Options> | undefined;
    if (!factory) {
      throw new Error(`Provider '${id}' is not registered`);
    }
    this.config.logger?.info?.('Creating provider instance', id);
    return factory.create({ config: this.config }, options);
  }
}

export function createTtsConductor(config: TtsRuntimeConfig): TtsConductor {
  return new TtsConductor(config);
}
