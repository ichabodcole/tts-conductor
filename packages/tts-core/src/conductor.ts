import type { BuildAudioOptions, TtsRuntimeConfig } from './config';
import type { TtsProvider } from './provider';
import type { TtsProviderFactory } from './factory';
import { ttsGenerateFull } from './operations';

export class TtsConductor {
  private providers = new Map<string, TtsProviderFactory<object>>();

  constructor(private readonly config: TtsRuntimeConfig) {}

  get runtimeConfig(): TtsRuntimeConfig {
    return this.config;
  }

  registerProvider(factory: TtsProviderFactory<object>) {
    this.providers.set(factory.id, factory);
    this.config.logger?.debug?.('Registered provider', factory.id);
  }

  hasProvider(id: string): boolean {
    return this.providers.has(id);
  }

  listProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  createProvider<Options extends object>(id: string, options: Options): TtsProvider {
    const factory = this.providers.get(id) as TtsProviderFactory<Options> | undefined;
    if (!factory) {
      throw new Error(`Provider '${id}' is not registered`);
    }
    this.config.logger?.info?.('Creating provider instance', id, { options });
    return factory.create({ config: this.config }, options);
  }

  async generateFull(
    rawText: string,
    provider: TtsProvider,
    onProgress?: (percent: number) => void,
    options?: BuildAudioOptions,
  ) {
    return ttsGenerateFull(rawText, provider, this.config, onProgress, options);
  }
}

export function createTtsConductor(config: TtsRuntimeConfig): TtsConductor {
  return new TtsConductor(config);
}
