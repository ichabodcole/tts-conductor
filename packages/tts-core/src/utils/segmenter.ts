import type { TtsLogger } from '../config';
import type { PauseTable } from './pause';
import { parsePauseDuration } from './pause';

export type Segment =
  | { kind: 'text'; value: string }
  | { kind: 'pause'; label: string; seconds: number };

const PAUSE_RE = /\[PAUSE:([A-Z_]+(?::\d+(?:\.\d+)?[xs]?)?|\d+(?:\.\d+)?s?)\]/gi;

export function parseScript(input: string, table: PauseTable, logger?: TtsLogger): Segment[] {
  // matchAll clones the source regex internally, so the module-level PAUSE_RE
  // is safe to use across concurrent calls (no shared lastIndex state).
  const segments: Segment[] = [];
  let lastIndex = 0;

  for (const match of input.matchAll(PAUSE_RE)) {
    const matchIndex = match.index ?? 0;
    if (matchIndex > lastIndex) {
      const textContent = input.slice(lastIndex, matchIndex).trim();
      if (textContent) {
        segments.push({ kind: 'text', value: textContent });
      }
    }

    const fullMatch = match[0] ?? '';
    const label = match[1] ?? '';
    const seconds = parsePauseDuration(fullMatch, table);

    if (!label) {
      logger?.warn?.('Invalid pause format encountered', { fullMatch });
    } else {
      segments.push({ kind: 'pause', label, seconds });
    }

    lastIndex = matchIndex + fullMatch.length;
  }

  if (lastIndex < input.length) {
    const textContent = input.slice(lastIndex).trim();
    if (textContent) {
      segments.push({ kind: 'text', value: textContent });
    }
  }

  // D4: automatic punctuation/dash fixups across pause boundaries. Two passes
  // on every text\u2192pause\u2192text triple, no config knobs. Documented in the core
  // README under "Script parsing behavior." Consumers wanting the raw split
  // should work with the segments returned here before passing to toChunks.
  for (let i = 1; i < segments.length - 1; i++) {
    const prev = segments[i - 1];
    const current = segments[i];
    const next = segments[i + 1];
    if (current.kind !== 'pause' || prev.kind !== 'text' || next.kind !== 'text') continue;

    const dashTail = prev.value.match(/[-\u2013\u2014]\s*$/u);
    if (dashTail) {
      prev.value = prev.value.replace(/[-\u2013\u2014]\s*$/u, '').replace(/\s+$/u, '');
      const cleaned = next.value.replace(/^\s+/u, '');
      const dashChar = dashTail[0]?.trim() || '—';
      next.value = `${dashChar} ${cleaned}`;
    }

    const punctuationMatch = next.value.match(/^(\s*)([.,!?:;…"')\]]+)/);
    if (punctuationMatch) {
      const punct = punctuationMatch[2] ?? '';
      if (punct) {
        prev.value = prev.value.replace(/\s+$/u, '') + punct;
        next.value = next.value.slice((punctuationMatch[0] ?? '').length).replace(/^\s+/u, '');
      }
    }
  }

  logger?.debug?.('[tts] parseScript output', segments);
  return segments;
}
