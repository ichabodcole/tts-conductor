import type { ProviderCapabilities } from '../provider';
import type { TtsLogger } from '../config';
import type { Segment } from './segmenter';

export interface Chunk {
  ssml: string;
  postPause: number;
}

function splitByBoundaries(input: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let text = input;
  const hardMax = Math.max(1, maxLen);

  const isInsideTag = (str: string, pos: number): boolean => {
    const lastLt = str.lastIndexOf('<', pos);
    const lastGt = str.lastIndexOf('>', pos);
    return lastLt > lastGt;
  };

  const adjustPosToAvoidTags = (str: string, pos: number): number => {
    if (!isInsideTag(str, pos)) return pos;
    const lt = str.lastIndexOf('<', pos);
    let p = lt > 0 ? lt - 1 : pos;
    while (p > 0 && !/\s/.test(str.charAt(p))) p--;
    return Math.max(1, p);
  };

  while (text.length > hardMax) {
    const window = text.slice(0, hardMax);

    let splitPos = window.lastIndexOf('\n\n');
    if (splitPos < 0) splitPos = window.lastIndexOf('\n');
    if (splitPos < 0) {
      const sentenceRe = /[.!?](?=\s|$)/g;
      let lastEnd = -1;
      let m: RegExpExecArray | null;
      while ((m = sentenceRe.exec(window))) {
        lastEnd = m.index + 1;
      }
      if (lastEnd >= 0) splitPos = lastEnd;
    }
    if (splitPos < 0) splitPos = window.lastIndexOf(' ');
    if (splitPos < 0) splitPos = hardMax;

    splitPos = adjustPosToAvoidTags(window, splitPos);

    const head = text.slice(0, splitPos).trimEnd();
    chunks.push(head);
    text = text.slice(splitPos).trimStart();
  }

  if (text) chunks.push(text);
  return chunks;
}

export function toChunks(
  segments: Segment[],
  caps: ProviderCapabilities,
  logger?: TtsLogger,
): Chunk[] {
  const INLINE_LIMIT = caps.maxInlineBreakSeconds ?? 0;
  const renderInlineBreak =
    caps.renderInlineBreak ?? ((seconds: number) => `<break time="${seconds}s" />`);
  const MAX_CHARS =
    typeof caps.maxCharsPerRequest === 'number' && isFinite(caps.maxCharsPerRequest)
      ? Math.max(1, caps.maxCharsPerRequest - 16)
      : undefined;

  const chunks: Chunk[] = [];
  let buffer = '';
  let postPause = 0;

  const flush = () => {
    if (buffer) {
      chunks.push({ ssml: buffer.trim(), postPause });
      buffer = '';
      postPause = 0;
    }
  };

  for (const seg of segments) {
    if (seg.kind === 'text') {
      const next = (buffer ? buffer + ' ' : '') + seg.value;
      if (MAX_CHARS && next.length > MAX_CHARS) {
        const parts = splitByBoundaries(next, MAX_CHARS);
        for (let i = 0; i < parts.length - 1; i++) {
          const part = (parts[i] ?? '').trim();
          if (part) {
            chunks.push({ ssml: part, postPause: 0 });
          }
        }
        const tail = parts.length > 0 ? parts[parts.length - 1] : '';
        buffer = tail ? tail : '';
        postPause = 0;
      } else {
        buffer = next;
      }
    } else {
      if (INLINE_LIMIT && seg.seconds <= INLINE_LIMIT) {
        const inlineBreak = renderInlineBreak(seg.seconds);
        buffer += ` ${inlineBreak}`;
      } else {
        postPause = seg.seconds;
        flush();
      }
    }
  }

  flush();
  logger?.debug?.('[tts] toChunks result', chunks);
  return chunks;
}
