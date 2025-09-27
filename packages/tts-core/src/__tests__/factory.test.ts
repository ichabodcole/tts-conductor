import { describe, expect, it } from 'vitest';
import type { TtsProviderFactory, TtsProviderContext } from '../factory';

const factory: TtsProviderFactory<{ token: string }> = {
  id: 'mock',
  create(ctx: TtsProviderContext, options) {
    return {
      caps: { maxInlineBreakSeconds: 1, maxCharsPerRequest: 50 },
      async generate(chunk: string) {
        return {
          audio: Buffer.from(`${chunk}:${options.token}`),
          mimeType: 'audio/mpeg',
          duration: 0,
          size: chunk.length,
        };
      },
    };
  },
};

describe('TtsProviderFactory', () => {
  it('creates provider using context configuration', async () => {
    const provider = factory.create({ config: { pauses: {} } }, { token: 'abc' });
    const result = await provider.generate('hello');

    expect(provider.caps.maxInlineBreakSeconds).toBe(1);
    expect(result.audio.toString()).toBe('hello:abc');
  });
});
