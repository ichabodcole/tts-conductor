import { TtsError } from '@alien-lobster-buffet/tts-conductor-core';
import { describe, expect, it } from 'vitest';
import {
  chatterboxTextToSpeech,
  elevenlabsTurboV25,
  FAL_DESCRIPTORS,
  flatBuildInput,
  gemini31FlashTts,
  minimaxSpeech02Hd,
} from '../descriptors';
import type { FalModelId } from '../types';

describe('flatBuildInput', () => {
  it('maps text to the configured text key, voice preset to the voice key, and merges params + defaults', () => {
    const build = flatBuildInput({ textKey: 'text', voiceKey: 'voice', defaults: { foo: 1 } });
    const out = build({
      text: 'hello',
      voice: { kind: 'preset', id: 'Rachel' },
      params: { stability: 0.5 },
    });
    expect(out).toEqual({ foo: 1, text: 'hello', voice: 'Rachel', stability: 0.5 });
  });

  it('omits the voice key when no preset voice is supplied', () => {
    const build = flatBuildInput({ textKey: 'prompt', voiceKey: 'voice' });
    expect(build({ text: 'hi' })).toEqual({ prompt: 'hi' });
  });
});

describe('minimax/speech-02-hd descriptor', () => {
  it('nests the preset voice id into a voice_setting object and forces output_format url', () => {
    const out = minimaxSpeech02Hd.buildInput({
      text: 'hello',
      voice: { kind: 'preset', id: 'Friendly_Person' },
    });
    expect(out.text).toBe('hello');
    expect(out.voice_setting).toMatchObject({ voice_id: 'Friendly_Person' });
    expect(out.output_format).toBe('url'); // forced for the alpha (schema-confirmed fetch path)
  });

  it('defaults voice_id when no voice is given and merges voiceSetting params', () => {
    const out = minimaxSpeech02Hd.buildInput({
      text: 'hi',
      params: { voiceSetting: { speed: 1.2, vol: 2 } },
    });
    expect(out.voice_setting).toEqual({ voice_id: 'Wise_Woman', speed: 1.2, vol: 2 });
  });

  it('lets the explicit voice win over a voice_id smuggled into params.voiceSetting', () => {
    const out = minimaxSpeech02Hd.buildInput({
      text: 'hi',
      voice: { kind: 'preset', id: 'Canonical' },
      params: { voiceSetting: { voice_id: 'Sneaky', speed: 1.1 } },
    });
    expect(out.voice_setting).toEqual({ voice_id: 'Canonical', speed: 1.1 });
  });

  it('falls back to a params.voiceSetting voice_id when no explicit voice is given', () => {
    const out = minimaxSpeech02Hd.buildInput({
      text: 'hi',
      params: { voiceSetting: { voice_id: 'FromParams' } },
    });
    expect(out.voice_setting).toEqual({ voice_id: 'FromParams' });
  });

  it('extracts audio url + mime, defaulting to audio/mpeg', () => {
    expect(minimaxSpeech02Hd.extractAudio({ audio: { url: 'https://x/a.mp3' } })).toEqual({
      url: 'https://x/a.mp3',
      mimeType: 'audio/mpeg',
    });
    expect(
      minimaxSpeech02Hd.extractAudio({
        audio: { url: 'https://x/a.mp3', content_type: 'audio/x' },
      }),
    ).toEqual({ url: 'https://x/a.mp3', mimeType: 'audio/x' });
  });

  it('extracts duration from duration_ms (ms → seconds)', () => {
    expect(minimaxSpeech02Hd.extractDuration?.({ duration_ms: 12345 })).toBeCloseTo(12.345);
    expect(minimaxSpeech02Hd.extractDuration?.({})).toBeUndefined();
  });
});

describe('gemini-3.1-flash-tts descriptor', () => {
  it('uses the prompt key and the voice enum for single-speaker (default Kore)', () => {
    expect(gemini31FlashTts.buildInput({ text: 'a tale' })).toMatchObject({
      prompt: 'a tale',
      voice: 'Kore',
      output_format: 'mp3',
    });
    expect(
      gemini31FlashTts.buildInput({ text: 'a tale', voice: { kind: 'preset', id: 'Puck' } }).voice,
    ).toBe('Puck');
  });

  it('maps multiSpeaker selection to speakers[] (SpeakerConfig) and omits voice', () => {
    const out = gemini31FlashTts.buildInput({
      text: 'Host: hi\nGuest: hello',
      voice: {
        kind: 'multiSpeaker',
        speakers: [
          { speakerId: 'Host', voiceId: 'Charon' },
          { speakerId: 'Guest', voiceId: 'Kore' },
        ],
      },
    });
    expect(out.speakers).toEqual([
      { speaker_id: 'Host', voice: 'Charon' },
      { speaker_id: 'Guest', voice: 'Kore' },
    ]);
    expect(out.voice).toBeUndefined();
  });

  it('forwards style_instructions / languageCode / temperature params when present', () => {
    const out = gemini31FlashTts.buildInput({
      text: 'x',
      params: { styleInstructions: 'warmly', languageCode: 'English (US)', temperature: 0.8 },
    });
    expect(out).toMatchObject({
      style_instructions: 'warmly',
      language_code: 'English (US)',
      temperature: 0.8,
    });
  });

  it('has no extractDuration (gemini returns no duration)', () => {
    expect(gemini31FlashTts.extractDuration).toBeUndefined();
    expect(gemini31FlashTts.extractAudio({ audio: { url: 'https://x/g.mp3' } })).toEqual({
      url: 'https://x/g.mp3',
      mimeType: 'audio/mpeg',
    });
  });
});

describe('chatterbox/text-to-speech descriptor', () => {
  it('maps a clone selection to audio_url and forwards generation params', () => {
    const out = chatterboxTextToSpeech.buildInput({
      text: 'clone me',
      voice: { kind: 'clone', audioUrl: 'https://x/ref.mp3' },
      params: { exaggeration: 0.4, cfg: 0.6, temperature: 0.8, seed: 7 },
    });
    expect(out).toMatchObject({
      text: 'clone me',
      audio_url: 'https://x/ref.mp3',
      exaggeration: 0.4,
      cfg: 0.6,
      temperature: 0.8,
      seed: 7,
    });
  });

  it('omits audio_url when no clone reference is given (fal uses its default)', () => {
    expect('audio_url' in chatterboxTextToSpeech.buildInput({ text: 'hi' })).toBe(false);
  });

  it('extracts audio with an audio/wav default mime', () => {
    expect(chatterboxTextToSpeech.extractAudio({ audio: { url: 'https://x/c.wav' } })).toEqual({
      url: 'https://x/c.wav',
      mimeType: 'audio/wav',
    });
  });

  it('throws a TtsError when the response carries no usable audio.url', () => {
    expect(() => chatterboxTextToSpeech.extractAudio({})).toThrow(TtsError);
    expect(() => chatterboxTextToSpeech.extractAudio({ audio: {} })).toThrow(TtsError);
    expect(() => chatterboxTextToSpeech.extractAudio({ audio: { url: 123 } })).toThrow(TtsError);
  });

  it('has no voiceCatalog (clone-only) and no extractDuration', () => {
    expect(chatterboxTextToSpeech.voiceCatalog).toBeUndefined();
    expect(chatterboxTextToSpeech.extractDuration).toBeUndefined();
  });
});

describe('elevenlabs/tts/turbo-v2.5 descriptor (flat)', () => {
  it('maps text + preset voice (default Rachel) and forwards 11labs scalar params', () => {
    expect(elevenlabsTurboV25.buildInput({ text: 'hi' })).toMatchObject({
      text: 'hi',
      voice: 'Rachel',
    });
    const out = elevenlabsTurboV25.buildInput({
      text: 'hi',
      voice: { kind: 'preset', id: 'Aria' },
      params: { stability: 0.3, similarity_boost: 0.9 },
    });
    expect(out).toMatchObject({ text: 'hi', voice: 'Aria', stability: 0.3, similarity_boost: 0.9 });
  });

  it('extracts audio with an audio/mpeg default mime', () => {
    expect(elevenlabsTurboV25.extractAudio({ audio: { url: 'https://x/e.mp3' } })).toEqual({
      url: 'https://x/e.mp3',
      mimeType: 'audio/mpeg',
    });
  });
});

describe('FAL_DESCRIPTORS registry', () => {
  const ids: FalModelId[] = [
    'fal-ai/minimax/speech-02-hd',
    'fal-ai/gemini-3.1-flash-tts',
    'fal-ai/chatterbox/text-to-speech',
    'fal-ai/elevenlabs/tts/turbo-v2.5',
  ];

  it('contains all four starter models, each keyed by its own endpointId', () => {
    for (const id of ids) {
      expect(FAL_DESCRIPTORS[id]).toBeDefined();
      expect(FAL_DESCRIPTORS[id].endpointId).toBe(id);
    }
  });

  it('reports maxInlineBreakSeconds null for every model (fal renders no inline breaks)', () => {
    for (const id of ids) {
      expect(FAL_DESCRIPTORS[id].caps.maxInlineBreakSeconds).toBeNull();
      expect(FAL_DESCRIPTORS[id].caps.maxCharsPerRequest).toBeGreaterThan(0);
    }
  });

  it('exposes a voiceCatalog only for gemini (the one schema-enumerable voice set)', () => {
    // gemini `voice` is a true 30-value enum. minimax `voice_id` and
    // elevenlabs-on-fal `voice` are free strings (examples, not enums) — no
    // authoritative list to enumerate — so they omit voiceCatalog for the alpha.
    // chatterbox is clone-only.
    expect(FAL_DESCRIPTORS['fal-ai/gemini-3.1-flash-tts'].voiceCatalog).toBeDefined();
    expect(FAL_DESCRIPTORS['fal-ai/minimax/speech-02-hd'].voiceCatalog).toBeUndefined();
    expect(FAL_DESCRIPTORS['fal-ai/elevenlabs/tts/turbo-v2.5'].voiceCatalog).toBeUndefined();
    expect(FAL_DESCRIPTORS['fal-ai/chatterbox/text-to-speech'].voiceCatalog).toBeUndefined();
  });
});
