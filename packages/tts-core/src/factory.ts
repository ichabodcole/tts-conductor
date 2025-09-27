import type { TtsRuntimeConfig } from './config';
import type { TtsProvider } from './provider';

export interface TtsProviderContext {
  config: TtsRuntimeConfig;
}

export interface TtsProviderFactory<Options extends object = Record<string, unknown>> {
  id: string;
  create: (ctx: TtsProviderContext, options: Options) => TtsProvider;
}
