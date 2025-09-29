import { TtsProviderFactory } from '@tts-conductor/core';

interface ElevenLabsVoiceSettings {
    stability?: number | null;
    use_speaker_boost?: boolean | null;
    similarity_boost?: number | null;
    style?: number | null;
    speed?: number | null;
}
type ElevenLabsQuality = 'draft' | 'standard' | 'high';
interface ElevenLabsProviderOptions {
    apiKey: string;
    voiceId: string;
    voiceSettings?: ElevenLabsVoiceSettings;
    quality?: ElevenLabsQuality;
}
declare module '@tts-conductor/core' {
    interface TtsProviderRegistry {
        '11labs': ElevenLabsProviderOptions;
    }
}
declare const elevenLabsProviderFactory: TtsProviderFactory<'11labs'>;

export { type ElevenLabsProviderOptions, type ElevenLabsQuality, type ElevenLabsVoiceSettings, elevenLabsProviderFactory };
