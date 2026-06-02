# 2026-05-23 — Verification batch (V1, V2, V4, V5, V6, V7)

## Goals

Sweep six items from the "Verification / hygiene" tier of `docs/backlog.md`. Per the original triage these were a mix of suspected-bugs-to-verify, defensive hardening, and small consumer-ergonomic improvements. V3 was already closed by the Phase B `matchAll` refactor and is omitted here.

## Completed Work

### V1 — `ElevenLabsVoiceSettings` camelCase alignment (real bug fix)

The interface used snake_case (`similarity_boost`, `use_speaker_boost`) while the ElevenLabs SDK's TypeScript interface uses camelCase. The cast `voiceSettings as ElevenLabsTypes.VoiceSettings` was masking the mismatch at compile time — at runtime the SDK reads `obj.similarityBoost` (undefined), silently dropping our `similarity_boost: 0.8` value. This is exactly the silent-failure pattern Story Loom flagged in issue #5/3.

The original backlog framing had the SDK expectation backwards: the _wire format_ uses snake_case, but the SDK's TS layer translates internally and exposes camelCase to consumers. Discovered during the investigation.

Fix: renamed `ElevenLabsVoiceSettings` fields to camelCase. Breaking change to the public type but pre-publish so free. Updated all test fixtures, the package README's usage example, and the JSDoc on `ElevenLabsCallOverrides.voiceSettings`. Backlog V1 entry rewritten to document the resolution and correct the original framing.

### V2 — `streamToBuffer` defensive collection (already correct, comment-only)

Investigated; the existing implementation already defends against non-Buffer chunk types correctly:

- Web stream path: `chunks.map(c => Buffer.from(c))` before `Buffer.concat`. Handles Uint8Array, ArrayBuffer, ArrayBufferLike.
- Node stream path: `Buffer.isBuffer(data) ? data : Buffer.from(data)` per chunk before push.

No functional change. Added a JSDoc comment on `streamToBuffer` explaining the defense so future maintainers don't think the per-chunk `Buffer.from` is redundant overhead.

### V4 — Temp-file collision under concurrency

Two concurrent `buildFinalAudio` calls hitting chunk index `i` within the same millisecond would collide on temp paths like `tts_chunk_0_1700000000000.mp3` and clobber each other in `os.tmpdir()`. Fixed by appending a 6-char base36 random token to every `Date.now()`-suffixed temp path:

- `tts_chunk_${i}_${ts}_${token}.mp3` / `.wav` (stitcher)
- `tts_concat_${ts}_${token}.wav`
- `tts_conductor_concat_${ts}_${token}.txt`
- `tts_${ts}_${token}.${container}` (default final filename when consumer doesn't supply one)
- `tts_conductor_temp_${ts}_${token}.mp3` (duration's ffprobe temp)

Centralized via a `tempToken()` helper in `stitcher.ts` with a rationale comment. `duration.ts` inlines the same `Math.random().toString(36).slice(2, 8)` with a cross-reference comment — not worth extracting to a shared util for one line.

### V5 — `silenceCache` key granularity

The silence-WAV cache was keyed by exact `seconds`, so `1.7` and `1.71` each generated their own near-identical WAV. Added `silenceCacheKey()` that rounds to 0.1s precision; both the cache key AND the generated WAV use the rounded duration so they stay aligned. Cache hit rate is higher; perceptual quality unaffected.

### V6 — Pause-duration upper clamp

Added optional `TtsRuntimeConfig.maxPauseSeconds`. When set as a positive number, any pause segment whose resolved duration exceeds the cap is clamped down before downstream code runs, logged at warn level. Default undefined — preserves current behavior for trusted-input use cases. Recommended for adversarial-input consumers (otherwise `[PAUSE:99999s]` would happily generate ~27 hours of silence per chunk).

JSDoc explicitly documents that `0` and negative values are silently treated as "no clamp," matching the defensive validation pattern used for `maxCharsPerRequest`.

### V7 — Strengthened provider `duration` contract docs

Expanded the JSDoc on `GenerationResult.duration` to be explicit that providers SHOULD supply this whenever the upstream API returns it. Documented the 50-100ms ffprobe-per-chunk overhead penalty for omitting it so future adapter authors understand the perf implication.

## Verification

`bun run check` (typecheck + Biome `--error-on-warnings` + 105 tests) green on the final state.

## Code Review

Dispatched `feature-dev:code-reviewer`. Verdict: **"Ready to merge: No / With fixes."** One critical + two important + one borderline. All four addressed.

**Critical fix — README example still used `similarity_boost: 0.8`.** The first-party package README's usage snippet showed the exact silent-bug pattern V1 was meant to eliminate. Would have actively taught new consumers the wrong API. Updated to `similarityBoost: 0.8`.

**Important fix — backlog V1 description now actively wrong post-fix.** Original framing said "ElevenLabs SDK expects snake_case." Inverted during investigation: the SDK's TS interface uses camelCase, the wire format uses snake_case, the SDK translates internally. Rewrote the V1 backlog entry to preserve the original framing as historical context, document the investigation outcome, and record the resolution.

**Stale comment cleanup.** A test comment referenced `similarity_boost` after the variable name was already updated to `similarityBoost`. Fixed.

**JSDoc clarification on `maxPauseSeconds`.** Reviewer noted that `maxPauseSeconds: 0` could plausibly mean "suppress all pauses" — but the guard `maxPause > 0` treats it as "no clamp." Added explicit JSDoc warning, with a pointer to using the pause table for pause-suppression instead.

**Reviewer affirmations** (no fix needed):

- `tempToken()` duplication between `stitcher.ts` and `duration.ts` is fine as-is — a shared util for one three-line expression isn't worth it; the cross-reference comment is sufficient.
- V5 0.1s precision is documented inline; named constant is a minor DX improvement, not required.
- V5 filename collision safety: intentional and safe — the cache guard prevents races, and `-y` makes any concurrent miss idempotent.
- V6 in-place segment mutation is acceptable: `parseScript` returns a fresh array each call, the mutated result is consumed immediately by `toChunks` and not exposed back to the caller.
- V7's "50-100ms ffprobe-per-chunk" claim is a reasonable ballpark, framed as illustrative overhead rather than a benchmark commitment.
- V5 cache-rounding test and V6 clamp tests both genuinely exercise real source code paths (not mock plumbing) — the `vi.resetModules()` pattern in `stitcher.test.ts` keeps the silenceCache state isolated per test.

## Outcomes

Six known-issue items closed across the verification tier. One was a real silent-failure bug (V1); two were defensive hardening that prevents future races and adversarial input (V4, V6); two were small ergonomic wins (V5, V2 comment); one was docs-only (V7). The verification tier from the backlog is now empty.

## Files Modified

- `packages/tts-core/src/config.ts` — `TtsRuntimeConfig.maxPauseSeconds?`
- `packages/tts-core/src/operations.ts` — pause clamp loop
- `packages/tts-core/src/provider.ts` — strengthened `GenerationResult.duration` JSDoc
- `packages/tts-core/src/utils/stitcher.ts` — `tempToken()` helper, random-suffixed temp paths, `silenceCacheKey()` rounding
- `packages/tts-core/src/utils/duration.ts` — random-suffixed ffprobe temp path
- `packages/tts-core/src/__tests__/operations.test.ts` — V6 clamp tests (fires + default-off)
- `packages/tts-core/src/__tests__/stitcher.test.ts` — V5 cache-rounding test
- `packages/tts-provider-elevenlabs/src/elevenLabsProvider.ts` — V1 interface rename, `streamToBuffer` JSDoc
- `packages/tts-provider-elevenlabs/src/__tests__/elevenLabsProvider.test.ts` — fixture updates for camelCase
- `packages/tts-provider-elevenlabs/src/__tests__/typed-integration.test.ts` — fixture updates for camelCase
- `packages/tts-provider-elevenlabs/README.md` — usage example updated to camelCase
- `docs/backlog.md` — V1 entry rewritten with resolution note
- `packages/tts-core/dist/*` — rebuilt

## Follow-ups

No new deferred items introduced by this branch — it closes items, doesn't open new ones. The V batch tier in `docs/backlog.md` is now empty; remaining backlog work is the breaking-shape decisions (already done), additive features (already done), docs polish (Task #14), and npm publish prep (Task #5 — which includes the pre-publish Bucket 1 sweep of `docs/deferred-items.md`).
