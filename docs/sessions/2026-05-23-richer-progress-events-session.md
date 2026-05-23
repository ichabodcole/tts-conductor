# 2026-05-23 — Richer lifecycle event API (A8)

## Goals

Add structured per-chunk lifecycle events alongside the legacy `onProgress(percent: number)` callback. Per `docs/backlog.md` item A8 — Story Loom flagged that SSE-streaming consumers, BullMQ progress payloads, and observability pipelines need more than a scalar percentage.

## Completed Work

### Event types (`packages/tts-core/src/events.ts`)

Discriminated union via `kind` field:

```ts
type TtsEvent =
  | { kind: "parse-complete"; segments; chunks }
  | { kind: "chunk-start"; index; total }
  | { kind: "chunk-complete"; index; total; duration; size }
  | { kind: "stitch-start"; chunks }
  | { kind: "stitch-complete"; duration; size };
```

Each variant has its own interface; `TtsEvent` is the union. Consumers `switch (event.kind)` for exhaustive TypeScript narrowing.

`TtsEventListener: (event: TtsEvent) => void | Promise<void>` — the `Promise<void>` permission is deliberate: catches the async-listener footgun where a consumer writes `async (e) => { await db.record(e); }` thinking it'll be awaited. We documented inline that the Promise is dropped on the floor; this lets the type system stay honest about what callers might naively try.

### Consumer surface

`BuildAudioOptions.onEvent?: TtsEventListener` — per-call subscriber. Coexists with the legacy `onProgress` positional arg; both fire independently. Documented inline that the listener is invoked synchronously and expensive work should be fire-and-forget.

### Event sequence for a successful N-chunk job

```
parse-complete  (1x, after parse + chunk: segments, chunks counts)
chunk-start     (N x, before each provider.generate: index, total)
chunk-complete  (N x, after each chunk: index, total, duration, size)
stitch-start    (1x, before buildFinalAudio: chunks count)
stitch-complete (1x, after buildFinalAudio: duration, size)
```

On abort/failure: promise rejects, no error event. Consumers handle errors via try/catch — adding an event-shaped error would create two error surfaces and consumer ambiguity.

### Threading

`ttsGenerateFull` fires `onEvent` at each lifecycle point. The pre-chunk side fires `chunk-start` **before** `onProgress`, matching the post-chunk side's `onProgress → chunk-complete` order — dual-subscriber consumers see consistent event-then-percentage progression throughout.

### New exports from `@tts-conductor/core`

- `TtsEvent` (union)
- `TtsEventListener` (subscriber signature)
- Individual variant types: `TtsParseCompleteEvent`, `TtsChunkStartEvent`, `TtsChunkCompleteEvent`, `TtsStitchStartEvent`, `TtsStitchCompleteEvent`

## Verification

`bun run check` (typecheck + Biome `--error-on-warnings` + 86 tests) green on the final state.

## Code Review

Dispatched `feature-dev:code-reviewer`. Verdict: **"Ready to merge: With fixes."** Two important issues + two enhancement-grade observations. All addressed:

**Important fix 1: `bytes` → `size`.** The event interfaces initially used `bytes` for the audio buffer length, but the rest of the public API (`GenerationResult.size`, `BuildFinalAudioResult.size`) uses `size`. Reviewer correctly flagged this as a coherence defect — since A8 hasn't shipped yet, the rename was free; after merge it'd be breaking. Renamed in both event interfaces and the two call sites in `operations.ts`.

**Important fix 2: chunk-start fired AFTER onProgress.** The pre-chunk `onProgress(10)` was emitted before the `chunk-start` event — inconsistent with the post-chunk side which fires `onProgress` then `chunk-complete`. Dual-subscriber consumers would have seen the percentage advance before receiving the structured event notifying them of the chunk start. Swapped the order so events fire first then onProgress.

**Enhancement: `TtsEventListener` return type now `void | Promise<void>`.** Reviewer noted that with the original `: void` return type, a consumer writing `async (e) => { await db.record(e); }` would have their Promise silently dropped without TypeScript catching it. The wider return type with explicit JSDoc ("we do NOT await the returned Promise") prevents the footgun. Surfaced one real bug in my own tests: the closure `(e) => events.push(e)` returns a number (array.push's return), which TypeScript now flags. Wrapped all the test listeners in `{}` to return void explicitly.

**Enhancement: multi-chunk test.** Reviewer noted the single-chunk default mocks don't exercise index progression (chunk-start with `index: 0, 1, 2` for a 3-chunk job). Added a test that overrides `toChunksMock` with 3 chunks and asserts `chunkStarts.map(e => e.index)` is `[0, 1, 2]` and `chunkCompletes.map(e => e.index)` is `[0, 1, 2]`, with `total: 3` throughout.

**Reviewer affirmations (no fix needed):**

- Discriminated union vs flat shape — discriminated union is the right TypeScript pattern (exhaustive `switch` narrowing)
- No `error` event — promise rejection is the canonical error path; adding event-shaped errors creates two surfaces
- No `chunk-failed` / `retry` events — orchestration doesn't retry; consumer-side retry is its own concern
- Synchronous listener semantics — fire-and-forget convention is correct for observability sinks; awaiting would introduce ordering complexity
- Zero-based indexing — idiomatic JS; consumers do `index + 1` for display

**Minor design note (not addressed):** `parse-complete` has no `onProgress` counterpart — dual-subscriber consumers will see the structured event with the progress still at 0%. Documented inline as a design choice rather than a synchronization point; the design intent is that both callbacks cover the same lifecycle but they don't have to be lockstep. Added to deferred items for review before publish.

## Outcomes

Structured per-chunk visibility unlocked for SSE / BullMQ / observability consumers. Backward-compatible with existing `onProgress` users. Discriminated union with `void | Promise<void>` return makes the type-system safer about async listeners.

## Files Modified

- `packages/tts-core/src/events.ts` — new module: 5 variant interfaces + union + listener type
- `packages/tts-core/src/config.ts` — `BuildAudioOptions.onEvent?` with JSDoc
- `packages/tts-core/src/operations.ts` — event firing at 5 lifecycle points, ordering fix
- `packages/tts-core/src/index.ts` — exports for all 7 event-related types
- `packages/tts-core/src/__tests__/operations.test.ts` — 6 new A8 tests + the multi-chunk progression test
- `packages/tts-core/dist/*` — rebuilt

## Follow-ups (added to deferred-items.md)

- **No `parse-complete` `onProgress` counterpart** — minor design note. Currently dual-subscriber consumers see `parse-complete` while progress is still at 0%. Could emit `onProgress?.(0)` explicitly or document as a known asymmetry. Low priority.

Other pre-existing deferred items unchanged; no new ones introduced.
