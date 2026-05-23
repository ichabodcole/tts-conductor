# 2026-05-23 — Deferred-items pre-publish sweep (D1 + D2 + D8a + D4)

## Goals

Bundle four items from `docs/deferred-items.md` Bucket 1 ("decide before publish") into one branch so they all land together before the first npm tag. D3 (1200 default) folded into Task #14 (docs polish) as a README tuning note — no code change.

## Completed Work

### D1 — `OUTPUT_FORMATS.AAC_128` preset

Added an AAC preset using ffmpeg's native `aac` encoder (`m4a` container, `audio/mp4` MIME, 128k @ 44.1kHz mono). This was the one missing format with a clear "Apple ecosystem" answer — iOS/Safari delivery, Apple Podcasts pipelines. Cole's use cases (guided visualization, hypnosis, long-form storytelling) skew toward mobile playback, so closing the gap before publish matters.

`libfdk_aac` left to consumers as a custom-`OutputFormat` escape hatch — it's GPL-incompatible and rarely shipped in stock ffmpeg distributions. Documented in the preset's JSDoc.

### D2 — Filename-mismatch warning

When a consumer-supplied `fileName` extension doesn't match `outputFormat.container`, `buildFinalAudio` now logs a `warn` with both the offending extension and the expected container. The filename is still honored verbatim — renaming would be more surprising than the mismatch. Extensionless filenames silently skip the warn (consistent with the silent-skip pattern used throughout the codebase for edge-case inputs).

Two tests cover both branches: warn-fires (`.mp3` filename + Opus codec) and warn-doesn't-fire (`.opus` filename + Opus codec).

### D8a — `onProgress?.(0)` before `parse-complete`

Promoted out of Bucket 2 because the events API freezes with v1.0 — fixing the asymmetry now is one line; fixing it as a behavior change post-publish is awkward. Previously `parse-complete` was the only lifecycle event with no matching `onProgress` tick; dual-subscriber consumers using both `onProgress` and `onEvent` saw a stream where the first event had no progress signal. Now every event boundary has a corresponding progress emission.

Test verifies that `onProgress.mock.calls[0]` is `[0]` AND that the first emitted event is `parse-complete` — proves the ordering, not just the existence of either signal.

### D4 — Per-package LICENSE files + `files` arrays

Copied the root `LICENSE` (MIT) to both `packages/tts-core/LICENSE` and `packages/tts-provider-elevenlabs/LICENSE`. Added `"LICENSE"` and `"README.md"` to each `package.json`'s `files` array. Option (a) from the original Bucket 1 recommendation — simpler than wiring release-please for it, works for any package manager, license travels with the install tarball as npm convention expects.

## Verification

`bun run check` (typecheck + Biome + tests) green. 109 tests passing (up from 105 — +1 D8a, +3 stitcher tests for D1/D2 fires/doesn't-fire).

## Code Review

Dispatched `feature-dev:code-reviewer`. Verdict: **"Ready to merge: Yes."**

**Reviewer affirmations** (no fix needed):

- D1: `m4a` container correctly relies on ffmpeg's extension-driven muxer auto-detection (same pattern as the existing `.opus` Ogg-muxer presets). No `-f` flag needed. Test verifies the new preset flows through to real ffmpeg arg construction (`'aac'`, `'128k'`, `'44100'`, `.m4a` extension).
- D2: `lastIndexOf('.')` correctly handles paths with dots in parent directories. Warning fires from real `buildFinalAudio` code before any `execa` mock is involved — not mock plumbing.
- D8a: No double-zero risk — the next `onProgress` after the new `0` tick is `10` (chunk loop) for normal jobs or `80` (stitch-start) for zero-chunk jobs. Test would fail if the line were removed (first call would be `[10]` not `[0]`).
- D4: LICENSE files contain correct MIT text with copyright attribution. `files` arrays correctly include `["dist", "LICENSE", "README.md"]`.

**Below-threshold observation** (not addressed):

- D2 doesn't warn on completely extensionless filenames (e.g., `'outputaudio'`). The reviewer flagged this as a documentation gap, not a bug — the silent-skip behavior is consistent with the rest of the codebase's edge-case handling. JSDoc could be tightened in a future docs branch, but it doesn't block this merge.

## Outcomes

Bucket 1 of `docs/deferred-items.md` is now empty. The two remaining pre-publish items (Task #5 npm publish prep, Task #14 docs polish covering D3 + D5) are independent and can land in either order.

## Files Modified

- `packages/tts-core/src/defaults.ts` — added `OUTPUT_FORMATS.AAC_128` preset
- `packages/tts-core/src/operations.ts` — `onProgress?.(0)` before `parse-complete`
- `packages/tts-core/src/utils/stitcher.ts` — filename-mismatch warning in `buildFinalAudio`
- `packages/tts-core/src/__tests__/stitcher.test.ts` — D1 AAC preset test, D2 fires + doesn't-fire tests
- `packages/tts-core/src/__tests__/operations.test.ts` — D8a onProgress(0) ordering test
- `packages/tts-core/package.json` — `files` array adds `LICENSE`, `README.md`
- `packages/tts-core/LICENSE` — copied from root
- `packages/tts-provider-elevenlabs/package.json` — `files` array adds `LICENSE`, `README.md`
- `packages/tts-provider-elevenlabs/LICENSE` — copied from root
- `docs/deferred-items.md` — D1, D2, D4, D8a marked RESOLVED with disposition notes; D3 noted as folded into Task #14
- `packages/tts-core/dist/*` — rebuilt

## Follow-ups

No new deferred items introduced by this branch. Remaining work:

- **Task #14** (docs polish) — D3 (1200 default tuning note), D5 (HTTP-date Retry-After test coverage), and the original D1-D5 docs items from `docs/backlog.md`
- **Task #5** (npm publish prep) — release-please config, GitHub Action wiring, npm provenance, final dry-run before tagging
