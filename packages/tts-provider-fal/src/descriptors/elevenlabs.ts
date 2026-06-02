import type { FalModelDescriptor } from '../types';
import { flatBuildInput } from './flatBuildInput';
import { locateAudio } from './shared';

/**
 * `fal-ai/elevenlabs/tts/turbo-v2.5` — the flat model: `text` key, `voice` id
 * (default Rachel), and 11labs scalar knobs (`stability` / `similarity_boost` /
 * `style` / `speed` / `previous_text` / `next_text` / `language_code` /
 * `apply_text_normalization`) forwarded via `params`. `voice` is a free string
 * with documented examples, not a schema enum, so no `voiceCatalog`. Returns
 * `.mp3`; no duration field → core ffprobe fallback.
 */
export const elevenlabsTurboV25: FalModelDescriptor = {
  endpointId: 'fal-ai/elevenlabs/tts/turbo-v2.5',
  // No schema char limit; 2000 is a deliberate narration default (a bit above
  // the direct 11labs adapter's 1200) balancing progress granularity against
  // request count. Soft — raise per job via BuildAudioOptions.maxCharsPerRequest.
  caps: { maxInlineBreakSeconds: null, maxCharsPerRequest: 2000 },
  buildInput: flatBuildInput({ textKey: 'text', voiceKey: 'voice', defaults: { voice: 'Rachel' } }),
  extractAudio: (data) => locateAudio(data, 'audio/mpeg'),
};
