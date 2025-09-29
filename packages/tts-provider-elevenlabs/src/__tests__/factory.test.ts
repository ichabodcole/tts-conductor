import type { TtsProviderContext, TtsRuntimeConfig } from '@tts-conductor/core';
import { describe, expect, it } from 'vitest';
import { elevenLabsProviderFactory } from '../elevenLabsProvider';

const runtimeConfig: TtsRuntimeConfig = {
  pauses: {},
};

const context: TtsProviderContext = {
  config: runtimeConfig,
  id: '11labs',
};

describe('elevenLabsProviderFactory', () => {
  it('requires apiKey and voiceId', () => {
    expect(() =>
      elevenLabsProviderFactory.create(context, {
        apiKey: '',
        voiceId: '',
      }),
    ).toThrow('ElevenLabs provider requires an apiKey');

    expect(() =>
      elevenLabsProviderFactory.create(context, {
        apiKey: 'key',
        voiceId: '',
      }),
    ).toThrow('ElevenLabs provider requires a voiceId');
  });

  it('creates provider when credentials present', () => {
    const provider = elevenLabsProviderFactory.create(context, {
      apiKey: 'key',
      voiceId: 'voice',
    });
    expect(provider.caps.maxInlineBreakSeconds).toBe(3);
  });
});
