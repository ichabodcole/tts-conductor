import type { FalModelDescriptor } from '../types';
import { locateAudio } from './shared';

/**
 * `fal-ai/chatterbox/text-to-speech` — voice cloning, no voice id. A `clone`
 * selection supplies `audio_url` (a plain URL string); omitting it lets fal use
 * its demo voice. Generation knobs (`exaggeration` / `cfg` / `temperature` /
 * `seed`) ride `params`. Returns `.wav`; no duration field → core ffprobe
 * fallback. No `voiceCatalog` — there are no enumerable speakers.
 */
const CHATTERBOX_PARAM_KEYS = ['exaggeration', 'cfg', 'temperature', 'seed'] as const;

export const chatterboxTextToSpeech: FalModelDescriptor = {
  endpointId: 'fal-ai/chatterbox/text-to-speech',
  caps: { maxInlineBreakSeconds: null, maxCharsPerRequest: 5000 },
  buildInput(input) {
    const params = input.params ?? {};
    const wire: Record<string, unknown> = { text: input.text };
    if (input.voice?.kind === 'clone') wire.audio_url = input.voice.audioUrl;
    for (const key of CHATTERBOX_PARAM_KEYS) {
      if (params[key] !== undefined) wire[key] = params[key];
    }
    return wire;
  },
  extractAudio: (data) => locateAudio(data, 'audio/wav'),
};
