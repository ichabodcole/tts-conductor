import type { FalModelDescriptor } from '../types';
import { geminiVoiceCatalog } from '../voiceCatalog';
import { locateAudio } from './shared';

/**
 * `fal-ai/gemini-3.1-flash-tts` — uses the `prompt` key (not `text`).
 * Single-speaker uses the `voice` enum (default Kore); multi-speaker maps the
 * canonical `speakers` to fal `SpeakerConfig[]` (`{ speaker_id, voice }`) and
 * omits `voice`. `style_instructions` / `language_code` / `temperature` ride
 * `params`. No duration field → core ffprobe fallback.
 *
 * **Multi-speaker + chunking caveat:** fal expects every request to carry the
 * full `speakers[]` AND the prompt to keep its `Alias:` line-prefixes. A naive
 * length-chunker can split mid-turn, so long multi-speaker scripts are not yet
 * supported — treat multi-speaker as single-chunk / short-form for now.
 */
export const gemini31FlashTts: FalModelDescriptor = {
  endpointId: 'fal-ai/gemini-3.1-flash-tts',
  // Schema allows up to 50000. Default 5000 favors progress granularity and a
  // small per-failure blast radius for narration. NB: smaller chunks mean more
  // fal.subscribe calls → more request_ids to reconcile + more stitch seams
  // (fal cost is ~per-request, not per-char), so long-form consumers should
  // raise this per job via BuildAudioOptions.maxCharsPerRequest (it's a soft
  // default, not a ceiling).
  caps: { maxInlineBreakSeconds: null, maxCharsPerRequest: 5000 },
  buildInput(input) {
    const params = input.params ?? {};
    const wire: Record<string, unknown> = {
      prompt: input.text,
      output_format: 'mp3',
    };
    if (params.styleInstructions !== undefined) wire.style_instructions = params.styleInstructions;
    if (params.languageCode !== undefined) wire.language_code = params.languageCode;
    if (params.temperature !== undefined) wire.temperature = params.temperature;

    if (input.voice?.kind === 'multiSpeaker') {
      wire.speakers = input.voice.speakers.map((s) => ({
        speaker_id: s.speakerId,
        voice: s.voiceId,
      }));
    } else {
      wire.voice = input.voice?.kind === 'preset' ? input.voice.id : 'Kore';
    }
    return wire;
  },
  extractAudio: (data) => locateAudio(data, 'audio/mpeg'),
  voiceCatalog: geminiVoiceCatalog,
};
