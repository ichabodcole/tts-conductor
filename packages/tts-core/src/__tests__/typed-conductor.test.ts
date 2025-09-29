import { describe, expect, it } from 'vitest';
import { createTtsConductor } from '../conductor';
import type { TtsRuntimeConfig } from '../config';
import type { TtsProviderContext } from '../factory';

// Mock provider for testing
interface MockProviderOptions {
  apiKey: string;
  model: string;
}

// Extend the registry to include our mock provider
declare module '../factory' {
  interface TtsProviderRegistry {
    'mock-provider': MockProviderOptions;
  }
}

const mockFactory = {
  id: 'mock-provider' as const,
  create(ctx: TtsProviderContext, options: MockProviderOptions) {
    return {
      id: ctx.id,
      caps: { maxInlineBreakSeconds: 1, maxCharsPerRequest: 100 },
      async generate(chunk: string) {
        return {
          audio: Buffer.from(`${chunk}:${options.apiKey}:${options.model}`),
          mimeType: 'audio/mpeg',
          duration: 1,
          size: chunk.length,
        };
      },
    };
  },
};

const runtimeConfig: TtsRuntimeConfig = {
  pauses: {},
};

describe('Typed TtsConductor', () => {
  it('should provide type-safe provider registration and creation', () => {
    const conductor = createTtsConductor(runtimeConfig);

    // Register the provider
    const providerId = conductor.registerProvider(mockFactory);
    expect(providerId).toBe('mock-provider');

    // Create a provider instance with correct options
    const provider = conductor.createProvider('mock-provider', {
      apiKey: 'test-key',
      model: 'test-model',
    });

    expect(provider.caps.maxInlineBreakSeconds).toBe(1);
  });

  it('should work with the consolidated API', () => {
    const conductor = createTtsConductor(runtimeConfig);

    // Register using the unified method
    const providerId = conductor.registerProvider(mockFactory);
    expect(providerId).toBe('mock-provider');

    // Create using the unified method
    const provider = conductor.createProvider('mock-provider', {
      apiKey: 'test-key',
      model: 'test-model',
    });

    expect(provider.caps.maxInlineBreakSeconds).toBe(1);
  });

  it('should throw error for unregistered provider', () => {
    const conductor = createTtsConductor(runtimeConfig);

    expect(() => {
      conductor.createProvider('mock-provider', {
        apiKey: 'test-key',
        model: 'test-model',
      });
    }).toThrow("Provider 'mock-provider' is not registered");
  });
});
