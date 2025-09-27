import { describe, expect, it } from 'vitest';
import { parseScript } from '../utils/segmenter';
import { parsePauseDuration } from '../utils/pause';
import { DEFAULT_PAUSE_TABLE } from '../defaults';

const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as const;

describe('parsePauseDuration', () => {
  it('handles numeric pauses', () => {
    expect(parsePauseDuration('[PAUSE:2s]', DEFAULT_PAUSE_TABLE)).toBe(2);
    expect(parsePauseDuration('[PAUSE:5]', DEFAULT_PAUSE_TABLE)).toBe(5);
  });

  it('handles labeled pauses', () => {
    expect(parsePauseDuration('[PAUSE:FULL_BREATH]', DEFAULT_PAUSE_TABLE)).toBe(5);
  });

  it('handles multipliers', () => {
    expect(parsePauseDuration('[PAUSE:FULL_BREATH:3x]', DEFAULT_PAUSE_TABLE)).toBe(15);
  });
});

describe('parseScript', () => {
  it('splits text and pauses', () => {
    const result = parseScript('Hello [PAUSE:SHORT] there', DEFAULT_PAUSE_TABLE, logger);
    expect(result).toEqual([
      { kind: 'text', value: 'Hello' },
      { kind: 'pause', label: 'SHORT', seconds: DEFAULT_PAUSE_TABLE.SHORT },
      { kind: 'text', value: 'there' },
    ]);
  });

  it('moves punctuation to previous segment', () => {
    const result = parseScript('Hello [PAUSE:SHORT] . Next', DEFAULT_PAUSE_TABLE, logger);
    expect(result).toEqual([
      { kind: 'text', value: 'Hello.' },
      { kind: 'pause', label: 'SHORT', seconds: DEFAULT_PAUSE_TABLE.SHORT },
      { kind: 'text', value: 'Next' },
    ]);
  });

  it('parses multiple scripts sequentially without losing pauses', () => {
    parseScript('First [PAUSE:SHORT] pass', DEFAULT_PAUSE_TABLE, logger);
    const result = parseScript('Second [PAUSE:SHORT] pass', DEFAULT_PAUSE_TABLE, logger);
    expect(result).toEqual([
      { kind: 'text', value: 'Second' },
      { kind: 'pause', label: 'SHORT', seconds: DEFAULT_PAUSE_TABLE.SHORT },
      { kind: 'text', value: 'pass' },
    ]);
  });
});
