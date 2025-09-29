import type { TtsRuntimeConfig } from '@tts-conductor/core';
import { createTtsConductor } from '@tts-conductor/core';
import { describe, expect, it, vi } from 'vitest';
import { elevenLabsProviderFactory } from '../elevenLabsProvider';

const runtimeConfig: TtsRuntimeConfig = {
  pauses: {},
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
  },
};

describe('ElevenLabs Typed Integration', () => {
  it('should register and create ElevenLabs provider with type safety', () => {
    const conductor = createTtsConductor(runtimeConfig);

    // Register the ElevenLabs provider
    const providerId = conductor.registerProvider(elevenLabsProviderFactory);
    expect(providerId).toBe('11labs');

    // Verify the provider is registered
    expect(conductor.hasProvider('11labs')).toBe(true);
    expect(conductor.listProviders()).toContain('11labs');

    // Create provider with type-safe options
    const provider = conductor.createProvider('11labs', {
      apiKey: 'test-key',
      voiceId: 'test-voice',
      quality: 'standard',
      voiceSettings: {
        stability: 0.5,
        similarity_boost: 0.8,
      },
    });

    expect(provider.caps.maxInlineBreakSeconds).toBe(3);
    expect(provider.caps.maxCharsPerRequest).toBe(1200);
  });

  it('should enforce correct option types at compile time', () => {
    const conductor = createTtsConductor(runtimeConfig);
    conductor.registerProvider(elevenLabsProviderFactory);

    // This should work fine:
    const provider = conductor.createProvider('11labs', {
      apiKey: 'test-key',
      voiceId: 'test-voice',
    });

    expect(provider.caps.maxInlineBreakSeconds).toBe(3);
  });

  it('should work with the consolidated API', () => {
    const conductor = createTtsConductor(runtimeConfig);

    // Register using the unified method
    const providerId = conductor.registerProvider(elevenLabsProviderFactory);
    expect(providerId).toBe('11labs');

    // Create using the unified method
    const provider = conductor.createProvider('11labs', {
      apiKey: 'test-key',
      voiceId: 'test-voice',
    });

    expect(provider.caps.maxInlineBreakSeconds).toBe(3);
  });
});
