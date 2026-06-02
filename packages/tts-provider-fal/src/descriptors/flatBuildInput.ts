import type { CanonicalTtsInput } from '../types';

export interface FlatBuildInputOptions {
  /** Wire key the chunk text maps to (`text` for most, `prompt` for gemini). */
  textKey: 'text' | 'prompt';
  /** Wire key a `preset` voice id maps to. */
  voiceKey: string;
  /** Static input merged in first (e.g. an output_format or default voice). */
  defaults?: Record<string, unknown>;
}

/**
 * Produces a `buildInput` for flat models — text at `textKey`, a `preset` voice
 * id at `voiceKey`, scalar `params` merged on top. Keeps one-line ergonomics for
 * structurally-simple models without a separate declarative code path; models
 * with object/multi-speaker/clone voice encoding hand-write `buildInput` instead.
 */
export function flatBuildInput(opts: FlatBuildInputOptions) {
  return (input: CanonicalTtsInput): Record<string, unknown> => ({
    ...opts.defaults,
    [opts.textKey]: input.text,
    ...(input.voice?.kind === 'preset' ? { [opts.voiceKey]: input.voice.id } : {}),
    ...(input.params ?? {}),
  });
}
