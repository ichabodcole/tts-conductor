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
        similarityBoost: 0.8,
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

  it('exposes voiceCatalog through the conductor-typed provider as optional (intentional erasure to VoiceCatalog<unknown>)', () => {
    // The conductor's createProvider returns TtsProvider<CallOverridesFor<T>>,
    // and TtsProvider.voiceCatalog is `VoiceCatalog<unknown>` — the
    // ElevenLabsRawVoice generic is erased at this boundary because
    // TtsProvider can't carry per-provider raw-record types without an
    // additional registry. This test pins down the intentional design:
    //   - `voiceCatalog` is reachable through the conductor path
    //   - it's typed as VoiceCatalog<unknown>, so `entry.raw` is unknown
    //   - consumers needing the typed raw record import ElevenLabsVoiceCatalog
    //     directly or cast via VoiceCatalogEntry<ElevenLabsRawVoice>
    const conductor = createTtsConductor(runtimeConfig);
    conductor.registerProvider(elevenLabsProviderFactory);

    const provider = conductor.createProvider('11labs', {
      apiKey: 'test-key',
      voiceId: 'test-voice',
    });

    // If this line compiles, voiceCatalog is properly optional on the
    // returned TtsProvider type.
    const catalogFn: () => Promise<unknown> = async () => {
      return provider.voiceCatalog?.listVoices();
    };

    expect(typeof catalogFn).toBe('function');
  });

  it('threads ElevenLabsCallOverrides through createProvider so per-call overrides typecheck', () => {
    // This test exists as a typecheck guard: if the conductor's createProvider
    // path ever loses the CallOverridesFor<T> wiring, the lines marked below
    // will fail to compile. Without this guard the failure mode is silent —
    // overrides still work at runtime but consumers see a `never`-typed second
    // parameter and have to cast.
    const conductor = createTtsConductor(runtimeConfig);
    conductor.registerProvider(elevenLabsProviderFactory);

    const provider = conductor.createProvider('11labs', {
      apiKey: 'test-key',
      voiceId: 'test-voice',
    });

    // If this line compiles, CallOverridesFor<'11labs'> is correctly resolving
    // to ElevenLabsCallOverrides through the conductor's typed return value.
    const overridesFn: (chunk: string) => ReturnType<typeof provider.generate> = (chunk) =>
      provider.generate(chunk, { overrides: { voiceId: 'override', quality: 'draft' } });

    expect(typeof overridesFn).toBe('function');
  });
});
