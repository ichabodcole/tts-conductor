import type { FalModelDescriptor, FalModelId } from '../types';
import { chatterboxTextToSpeech } from './chatterbox';
import { elevenlabsTurboV25 } from './elevenlabs';
import { gemini31FlashTts } from './gemini';
import { minimaxSpeech02Hd } from './minimax';

export { chatterboxTextToSpeech } from './chatterbox';
export { elevenlabsTurboV25 } from './elevenlabs';
export { type FlatBuildInputOptions, flatBuildInput } from './flatBuildInput';
export { gemini31FlashTts } from './gemini';
export { minimaxSpeech02Hd } from './minimax';

/** Registry of every supported fal model, keyed by its `endpointId`. */
export const FAL_DESCRIPTORS: Record<FalModelId, FalModelDescriptor> = {
  'fal-ai/minimax/speech-02-hd': minimaxSpeech02Hd,
  'fal-ai/gemini-3.1-flash-tts': gemini31FlashTts,
  'fal-ai/chatterbox/text-to-speech': chatterboxTextToSpeech,
  'fal-ai/elevenlabs/tts/turbo-v2.5': elevenlabsTurboV25,
};
