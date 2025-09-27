import { TtsProviderFactory } from '@tts-conductor/core';

interface ElevenLabsProviderOptions {
    apiKey: string;
    voiceId: string;
}
declare const elevenLabsProviderFactory: TtsProviderFactory<ElevenLabsProviderOptions>;

export { type ElevenLabsProviderOptions, elevenLabsProviderFactory as default, elevenLabsProviderFactory };
