import type { TtsRuntimeConfig } from './config';
import type { TtsProvider } from './provider';

export interface TtsProviderContext {
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
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface TtsProviderRegistry {
  // Base registry - provider packages extend this via module augmentation
}

/**
 * Type helper to get the options type for a specific provider ID
 */
export type ProviderOptionsFor<T extends keyof TtsProviderRegistry> = TtsProviderRegistry[T];

/**
 * Type helper to get all registered provider IDs
 */
export type RegisteredProviderIds = keyof TtsProviderRegistry;

/**
 * Type-safe factory interface for registered providers.
 * All providers must be registered in TtsProviderRegistry via module augmentation.
 */
export interface TtsProviderFactory<T extends RegisteredProviderIds> {
  id: T;
  create: (ctx: TtsProviderContext, options: ProviderOptionsFor<T>) => TtsProvider;
}
