import { describe, expect, it } from 'vitest';
import type { TtsRuntimeConfig } from '../config';

describe('TtsRuntimeConfig', () => {
  it('allows optional logger and debug sinks', () => {
    const config: TtsRuntimeConfig = {
      pauses: { SHORT: 1 },
      logger: {
        info: () => {},
      },
      debug: {
        saveBuffer: async () => {},
      },
    };

    expect(config.pauses.SHORT).toBe(1);
    expect(config.logger?.info).toBeTypeOf('function');
    expect(config.debug?.saveBuffer).toBeTypeOf('function');
  });

  it('can optionally include ffmpeg configuration', () => {
    const config: TtsRuntimeConfig = {
      pauses: {},
      ffmpeg: {
        ffmpegPath: '/usr/bin/ffmpeg',
        ffprobePath: '/usr/bin/ffprobe',
      },
    };

    expect(config.ffmpeg?.ffmpegPath).toBe('/usr/bin/ffmpeg');
    expect(config.ffmpeg?.ffprobePath).toBe('/usr/bin/ffprobe');
  });
});
