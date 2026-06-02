import { TtsError } from '@alien-lobster-buffet/tts-conductor-core';
import type { FalAudioLocation } from '../types';

/**
 * Locate the audio URL (+ mime) in a fal TTS response. All four starter models
 * return `audio` as a fal `File` (`{ url, content_type? }`) when
 * `output_format` is url-based — the provider's shared fetch turns the URL into
 * bytes. Throws a {@link TtsError} if the response carries no usable `audio.url`
 * (already-classified, so the provider passes it through without re-wrapping).
 */
export function locateAudio(data: unknown, defaultMime: string): FalAudioLocation {
  const audio = (data as { audio?: { url?: unknown; content_type?: unknown } } | null | undefined)
    ?.audio;
  const url = typeof audio?.url === 'string' ? audio.url : undefined;
  if (!url) {
    throw new TtsError('[fal] response did not contain an audio.url');
  }
  const mimeType = typeof audio?.content_type === 'string' ? audio.content_type : defaultMime;
  return { url, mimeType };
}
