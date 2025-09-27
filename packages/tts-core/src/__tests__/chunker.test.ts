import { describe, expect, it } from 'vitest';
import { toChunks } from '../utils/chunker';
import type { Segment } from '../utils/segmenter';
import type { ProviderCapabilities } from '../provider';

const caps: ProviderCapabilities = { maxInlineBreakSeconds: 2, maxCharsPerRequest: 50 };
const logger = { debug: () => {} } as const;

describe('toChunks', () => {
  it('respects max char limit', () => {
    const segments: Segment[] = [{ kind: 'text', value: 'A'.repeat(80) }];
    const chunks = toChunks(segments, caps, logger);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.ssml.length <= 50)).toBe(true);
  });

  it('inlines short pauses', () => {
    const segments: Segment[] = [
      { kind: 'text', value: 'Hello' },
      { kind: 'pause', label: 'SHORT', seconds: 1 },
      { kind: 'text', value: 'world' },
    ];
    const chunks = toChunks(segments, caps, logger);
    expect(chunks).toEqual([{ ssml: 'Hello <break time="1s" /> world', postPause: 0 }]);
  });

  it('creates post pause for longer breaks', () => {
    const segments: Segment[] = [
      { kind: 'text', value: 'Hello' },
      { kind: 'pause', label: 'LONG', seconds: 5 },
      { kind: 'text', value: 'world' },
    ];
    const chunks = toChunks(segments, caps, logger);
    expect(chunks).toEqual([
      { ssml: 'Hello', postPause: 5 },
      { ssml: 'world', postPause: 0 },
    ]);
  });

  it('uses provider-defined inline break renderer when available', () => {
    const customCaps: ProviderCapabilities = {
      maxInlineBreakSeconds: 2,
      renderInlineBreak: (seconds) => `<mark name="pause:${seconds}"/>`,
    };
    const segments: Segment[] = [
      { kind: 'text', value: 'Wait' },
      { kind: 'pause', label: 'SHORT', seconds: 2 },
      { kind: 'text', value: 'go' },
    ];
    const chunks = toChunks(segments, customCaps, logger);
    expect(chunks).toEqual([{ ssml: 'Wait <mark name="pause:2"/> go', postPause: 0 }]);
  });
});
