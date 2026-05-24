# 2026-05-23 — Docs polish pre-publish (D1–D5 + deferred-D3)

## Goals

Close Task #14. Pre-publish documentation pass covering items D1–D5 from `docs/backlog.md` (the items each downstream consumer would otherwise burn a debugging cycle on) plus the deferred-D3 ElevenLabs `maxCharsPerRequest` tuning note.

## Completed Work

### Root README

Fixed stale `ESLint (flat config)` line — the repo migrated to Biome during the Phase B tooling migration. Now reads `Biome – formatting and lint via bun run check / bun run lint`.

### Core README

Four new sections:

- **Debug sink async-safety** (D3) — explains that `saveBuffer` / `saveFile` are awaited inside the orchestration loop, so blocking I/O scales total job time by `chunks × sink_latency`. S3-style sinks should fire-and-forget. Concrete code example showing the `void promise.catch(...)` pattern with explicit cost framing for sinks that genuinely need synchronous durability.
- **Progress reporting and BullMQ heartbeats** (D1) — demonstrates using `onProgress` as `job.updateProgress(pct)` to defeat BullMQ's stall detection. Notes coexistence with `onEvent` for richer per-stage updates, references the `TtsEvent` discriminated union.
- **Script parsing behavior** (D4) — documents the two automatic fixups `parseScript` applies across pause-marker boundaries (dashes lead, leading punctuation attaches backward), with a worked example for each. Notes the triple-only constraint (`text → pause → text`) and that pauses at script edges or in pairs are left alone. Escape hatch documented: work with the segments before they reach `toChunks` if the raw split is needed.
- **Inline pause rendering (provider extensibility)** (D5) — strengthens the "this is load-bearing for non-SSML engines" framing around `caps.renderInlineBreak`. Explicit "don't inline the SSML literal anywhere outside the fallback" architectural note so future maintainers don't accidentally fragment the override point.

Also fixed the stale ESLint reference in the Scripts section.

### ElevenLabs README

Three new sections:

- **Model + format guidance** (D2) — explains why `eleven_multilingual_v2` + `mp3_44100_128` is the right default for long-form narration. Documents that `high` is an alias for `standard` (with the reasoning behind keeping it). Warns explicitly about the audible quality drop on turbo for long-form content.
- **Tuning throughput vs. progress granularity** (deferred-D3) — documents the `1200` default vs the `~5000` observed server limit. Shows the per-call override snippet. Warns about hitting the server cap surfacing as `TtsInvalidInputError`.

Also fixed the stale ESLint reference and the usage example camelCase fields (already done in the verification batch, but the file was rewritten here so verified the camelCase form was preserved).

### Inline architectural anchors

Two small JSDoc comments added at the actual code locations to prevent regression:

- `segmenter.ts:46` — comment pointing at the README's "Script parsing behavior" section and reminding maintainers there are no config knobs, this is unconditional behavior.
- `chunker.ts:63` — comment marking `caps.renderInlineBreak` as the only override point in the pipeline, with the "don't inline the SSML literal elsewhere" guard rail.

These exist because docs in README files are easy to lose track of when refactoring source; an anchor at the code location is the cheapest insurance against regression.

## Verification

`bun run check` — green. 109 tests still passing (no code logic changed).

## Code Review

Dispatched `feature-dev:code-reviewer` with explicit instructions to do an accuracy check (do the doc claims match the actual code?). Verdict: **"Ready to merge: Yes."**

Reviewer specifically verified:

- D4 dash + leading-punctuation fixup logic against `segmenter.ts` lines 50-72 — both directions and the triple-only constraint matched.
- D2 model IDs (`eleven_turbo_v2_5`, `eleven_multilingual_v2`) against `ELEVENLABS_DEFAULTS.models` — exact match.
- deferred-D3 `maxCharsPerRequest: 1200` claim + override path against `provider.ts` and `BuildAudioOptions.maxCharsPerRequest` — confirmed.
- BullMQ snippet's positional argument order and `signal: job.abortSignal` field name — both real.
- D5 architectural note against `chunker.ts:63` — confirmed `caps.renderInlineBreak` is the only override point.
- D3 debug sink await pattern against `operations.ts:134` — confirmed `await saveDebugFromBuffer(...)` is in the chunk loop, blocking next chunk.

No factual errors found. One typographic vs straight-quote nit in the leading-punctuation character set was flagged as not material (the README describes intent, the code lists exact codepoints; almost all hand-authored scripts use ASCII straight quotes).

## Outcomes

Task #14 closed. The pre-publish documentation pass is done — every D1-D5 item from `docs/backlog.md` is addressed, and the deferred D3 (1200 maxCharsPerRequest tuning) is folded into the ElevenLabs README. Future maintainers will find the same information at the README level AND at the inline JSDoc anchors in source.

## Files Modified

- `README.md` — Biome reference fix
- `packages/tts-core/README.md` — D1 (BullMQ heartbeat), D3 (debug async-safety), D4 (parseScript behavior), D5 (inline pause rendering)
- `packages/tts-core/src/utils/segmenter.ts` — D4 architectural anchor comment
- `packages/tts-core/src/utils/chunker.ts` — D5 architectural anchor comment
- `packages/tts-provider-elevenlabs/README.md` — D2 (model + format guidance), deferred-D3 (1200 tuning section), Biome reference fix

## Follow-ups

No new deferred items introduced. The README polish needed for actual npm publish (top-level Installation section, version badges, links to source, etc.) is part of Task #5 (publish prep) — Task #14's scope is specifically the D1-D5 hygiene items.
