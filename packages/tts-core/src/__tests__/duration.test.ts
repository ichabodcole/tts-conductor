import { describe, expect, it } from 'vitest';
import { estimateAudioDuration } from '../utils/duration';

describe('estimateAudioDuration', () => {
  it('estimates duration based on buffer size and bitrate', () => {
    const fakeAudio = Buffer.alloc(128000); // 128kB -> 8 seconds at 128 kbps
    const duration = estimateAudioDuration(fakeAudio, 128);
    expect(duration).toBeCloseTo(8, 2);
  });

  it('respects custom bitrate', () => {
    const fakeAudio = Buffer.alloc(64000); // 64kB -> 8 seconds at 64 kbps
    const duration = estimateAudioDuration(fakeAudio, 64);
    expect(duration).toBeCloseTo(8, 2);
  });
});
