import type { FalModelDescriptor } from '../types';
import { locateAudio } from './shared';

/**
 * `fal-ai/minimax/speech-02-hd` — object-voice. The preset voice id nests into a
 * `voice_setting` object alongside scalar knobs (vol/speed/pitch/emotion via
 * `params.voiceSetting`). `output_format` is forced to `url` so the response is
 * the schema-confirmed `audio.url` fetch shape shared by all four models (hex
 * inline bytes are a possible later optimization). minimax is the only starter
 * model that returns a duration (`duration_ms`).
 */
export const minimaxSpeech02Hd: FalModelDescriptor = {
  endpointId: 'fal-ai/minimax/speech-02-hd',
  // Schema hard limit is 5000 chars; used directly as the chunk budget.
  caps: { maxInlineBreakSeconds: null, maxCharsPerRequest: 5000 },
  buildInput(input) {
    const params = input.params ?? {};
    const voiceSetting = (params.voiceSetting as Record<string, unknown> | undefined) ?? {};
    const presetId = input.voice?.kind === 'preset' ? input.voice.id : undefined;
    const wire: Record<string, unknown> = {
      text: input.text,
      voice_setting: {
        ...voiceSetting,
        // The explicit canonical voice wins over a voice_id smuggled into
        // params.voiceSetting; fall back to that, then the model default.
        voice_id: presetId ?? voiceSetting.voice_id ?? 'Wise_Woman',
      },
      output_format: 'url',
    };
    if (params.audioSetting !== undefined) wire.audio_setting = params.audioSetting;
    if (params.languageBoost !== undefined) wire.language_boost = params.languageBoost;
    return wire;
  },
  extractAudio: (data) => locateAudio(data, 'audio/mpeg'),
  extractDuration(data) {
    const ms = (data as { duration_ms?: unknown }).duration_ms;
    return typeof ms === 'number' ? ms / 1000 : undefined;
  },
  // minimax voice_id is a free string with documented examples (not a schema
  // enum), so there's no authoritative list to enumerate — voiceCatalog omitted.
};
