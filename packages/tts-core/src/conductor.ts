import type { BuildAudioOptions, TtsRuntimeConfig } from './config';
import type {
  CallOverridesFor,
  ProviderOptionsFor,
  RegisteredProviderIds,
  TtsProviderContext,
  TtsProviderFactory,
} from './factory';
import { ttsGenerateFull } from './operations';
import type { TtsProvider } from './provider';
import type { BuildFinalAudioResult } from './utils/stitcher';

// Storage erases the TCallOverrides generic for simplicity (Map can't carry
// per-key types). createProvider reconstructs the typed view at access time
// via the CallOverridesFor<T> mapping registered alongside provider options.
// Using `unknown` (rather than `any`) at the storage boundary keeps the
// internal surface honest — callers must go through createProvider, which
// casts to the proper TtsProvider<CallOverridesFor<T>>.
interface StoredFactory {
  id: string;
  create: (ctx: TtsProviderContext, options: object) => TtsProvider<unknown>;
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
  registerProvider<T extends RegisteredProviderIds, TCallOverrides = CallOverridesFor<T>>(
    factory: TtsProviderFactory<T, TCallOverrides>,
  ): T {
    this.providers.set(factory.id, {
      id: factory.id,
      create: factory.create as (ctx: TtsProviderContext, options: object) => TtsProvider<unknown>,
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
  ): TtsProvider<CallOverridesFor<T>> {
    const factory = this.providers.get(id);
    if (!factory) {
      throw new Error(`Provider '${id}' is not registered`);
    }
    this.config.logger?.info?.('Creating provider instance', id, { options });
    return factory.create({ config: this.config, id: factory.id }, options) as TtsProvider<
      CallOverridesFor<T>
    >;
  }

  async generateFull(
    rawText: string,
    provider: TtsProvider,
    onProgress?: (percent: number) => void,
    options?: BuildAudioOptions,
  ): Promise<BuildFinalAudioResult> {
    return ttsGenerateFull(rawText, provider, this.config, onProgress, options);
  }
}

export function createTtsConductor(config: TtsRuntimeConfig): TtsConductor {
  return new TtsConductor(config);
}
