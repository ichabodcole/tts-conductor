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
 * declare module '@alien-lobster-buffet/tts-conductor-core' {
 *   interface TtsProviderRegistry {
 *     '11labs': ElevenLabsProviderOptions;
 *     'my-provider': MyProviderOptions;
 *   }
 * }
 */
// biome-ignore lint/suspicious/noEmptyInterface: declaration-merging target — must stay an empty interface so provider packages can augment it via `interface TtsProviderRegistry { ... }`.
export interface TtsProviderRegistry {}

/**
 * Type helper to get the options type for a specific provider ID
 */
export type ProviderOptionsFor<T extends keyof TtsProviderRegistry> = TtsProviderRegistry[T];

/**
 * Type helper to get all registered provider IDs
 */
export type RegisteredProviderIds = keyof TtsProviderRegistry;

/**
 * Parallel registry for per-call override types. Providers that accept per-call
 * overrides on `generate()` register their override-shape here via module
 * augmentation, alongside their construction-time options entry in
 * `TtsProviderRegistry`. Providers that don't support per-call overrides leave
 * this unregistered — `CallOverridesFor<T>` resolves to `never` for them.
 *
 * Example usage in a provider package:
 *
 * declare module '@alien-lobster-buffet/tts-conductor-core' {
 *   interface TtsProviderRegistry {
 *     'my-provider': MyProviderOptions;
 *   }
 *   interface TtsProviderCallOverridesRegistry {
 *     'my-provider': MyProviderCallOverrides;
 *   }
 * }
 */
// biome-ignore lint/suspicious/noEmptyInterface: declaration-merging target — provider packages augment this via `interface TtsProviderCallOverridesRegistry`.
export interface TtsProviderCallOverridesRegistry {}

/**
 * Resolves to the per-call overrides type registered for provider ID `T`, or
 * `never` if `T` does not have a `TtsProviderCallOverridesRegistry` entry. Used
 * by `TtsConductor.createProvider` to return a properly-typed provider so
 * `provider.generate(chunk, overrides)` typechecks against the registered
 * override shape.
 */
export type CallOverridesFor<T extends string> = T extends keyof TtsProviderCallOverridesRegistry
  ? TtsProviderCallOverridesRegistry[T]
  : never;

/**
 * Type-safe factory interface for registered providers.
 *
 * `TCallOverrides` declares the shape of per-call overrides that the produced
 * provider accepts as the second argument to `generate()`. Defaults to `never`
 * for providers that don't support per-call overrides — keeps the factory
 * signature backward-compatible with v1.1 adapters.
 *
 * All providers must be registered in `TtsProviderRegistry` via module
 * augmentation.
 */
export interface TtsProviderFactory<T extends RegisteredProviderIds, TCallOverrides = never> {
  id: T;
  create: (ctx: TtsProviderContext, options: ProviderOptionsFor<T>) => TtsProvider<TCallOverrides>;
}
