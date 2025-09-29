import { describe, expect, it } from 'vitest';
import type { TtsProviderContext } from '../factory';

// Test the internal base factory interface behavior
const mockFactory = {
  id: 'mock',
  create(ctx: TtsProviderContext, options: { token: string }) {
    return {
      id: ctx.id,
      caps: { maxInlineBreakSeconds: 1, maxCharsPerRequest: 50 },
      async generate(chunk: string) {
        return {
          audio: Buffer.from(`${chunk}:${options.token}`),
          mimeType: 'audio/mpeg',
          duration: 1.5,
          size: chunk.length,
        };
      },
    };
  },
};

describe('TtsProviderFactory', () => {
  it('creates provider using context configuration', async () => {
    const provider = mockFactory.create({ config: { pauses: {} }, id: 'mock' }, { token: 'abc' });
    const result = await provider.generate('hello');

    expect(provider.caps.maxInlineBreakSeconds).toBe(1);
    expect(provider.id).toBe('mock');
    expect(result.audio.toString()).toBe('hello:abc');
  });
});
