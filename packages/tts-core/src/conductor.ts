import type { BuildAudioOptions, TtsRuntimeConfig } from './config';
import type {
  ProviderOptionsFor,
  RegisteredProviderIds,
  TtsProviderContext,
  TtsProviderFactory,
} from './factory';
import { ttsGenerateFull } from './operations';
import type { TtsProvider } from './provider';

// Use a more flexible approach - store the factory with minimal typing
interface StoredFactory {
  id: string;
  create: (ctx: TtsProviderContext, options: object) => TtsProvider;
}

export class TtsConductor {
  private providers = new Map<string, StoredFactory>();

  constructor(private readonly config: TtsRuntimeConfig) {}

  get runtimeConfig(): TtsRuntimeConfig {
    return this.config;
  }

  /**
   * Register a provider factory with type-safe options.
   * Provider must be registered in the TtsProviderRegistry via module augmentation.
   */
  registerProvider<T extends RegisteredProviderIds>(factory: TtsProviderFactory<T>): T {
    this.providers.set(factory.id, {
      id: factory.id,
      create: factory.create as (ctx: TtsProviderContext, options: object) => TtsProvider,
    });
    this.config.logger?.debug?.('Registered provider', factory.id);
    return factory.id;
  }

  hasProvider(id: string): boolean {
    return this.providers.has(id);
  }

  listProviders(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Create a provider instance with type-safe options.
   * Provider must be registered in the TtsProviderRegistry via module augmentation.
   */
  createProvider<T extends RegisteredProviderIds>(
    id: T,
    options: ProviderOptionsFor<T>,
  ): TtsProvider {
    const factory = this.providers.get(id);
    if (!factory) {
      throw new Error(`Provider '${id}' is not registered`);
    }
    this.config.logger?.info?.('Creating provider instance', id, { options });
    return factory.create({ config: this.config, id: factory.id }, options);
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
