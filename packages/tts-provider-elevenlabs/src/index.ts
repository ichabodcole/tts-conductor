import type { TtsProviderFactory } from '@tts-conductor/core';

export interface ElevenLabsProviderOptions {
  apiKey: string;
  voiceId: string;
}

export const elevenLabsProviderFactory: TtsProviderFactory<ElevenLabsProviderOptions> = {
  id: '11labs',
  create(ctx, options) {
    ctx.config.logger?.debug?.('[ElevenLabs] init', { hasKey: Boolean(options.apiKey) });

    return {
      id: '11labs',
      async synthesize(ssml: string) {
        ctx.config.logger?.warn?.('[ElevenLabs] synthesize called before implementation', {
          hasInput: ssml.length > 0,
        });
        throw new Error('createElevenLabsProvider not yet implemented');
      },
    };
  },
};

export default elevenLabsProviderFactory;
