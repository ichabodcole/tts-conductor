# Deferred Items

A living list of things that came up during implementation, weren't acted on at the time, and need an explicit decision before (or after) the first npm publish. Each item carries a recommendation and a brief rationale.

The convention going forward: when a branch finalizes and the code review flags something deferred, it lands here with a recommendation. We sweep this list before npm publish to make sure nothing slipped through.

Three buckets:

1. **Decide before publish** — small enough to address now or makes a real difference to first-publish quality. Action: pick a disposition (do now / do soon / defer / never).
2. **Defer to post-publish (1.x minor)** — not blocking, can land as additive improvements. Action: leave on the list, address opportunistically.
3. **Won't do (or wait for v2)** — explicit decision not to address. Action: documented here so we don't re-relitigate.

---

## Bucket 1 — Decide before publish

### D1. AAC preset for iOS/Safari delivery

**Source:** A7 (output format) review.

**Context:** The output-format presets cover MP3 (4 bitrates), Opus (mono + stereo), FLAC, WAV. The reviewer flagged that AAC (`aac` codec or `libfdk_aac`, `m4a` container, `audio/mp4` MIME) is a real gap for iOS/Safari delivery and Apple Podcasts pipelines. ffmpeg's native `aac` encoder is decent; `libfdk_aac` is higher quality but not always built into ffmpeg distributions.

**Recommendation:** Add as `AAC_128` preset using the native `aac` encoder before publish if there's a known consumer who needs it; otherwise defer to 1.x minor (`AAC_128` is ~20 lines including a coherence test). The risk of leaving it out: consumers who need AAC have to write their own `OutputFormat` object, which is documented and works fine.

**Decision needed:** Add `AAC_128` to the presets now, or wait for a real consumer ask?

### D2. Filename-mismatch warning

**Source:** A7 review.

**Context:** When a consumer supplies a `fileName` to `buildFinalAudio` that doesn't match `outputFormat.container`, the library produces a file with the consumer's extension (e.g., `.mp3` filename + Opus codec → an `.mp3` file containing Opus). Documented as a foot-gun in the JSDoc; the reviewer suggested a 3-line `logger.warn(...)` when the extensions don't match.

**Recommendation:** Add the warning. Small, defensive, prevents a documented FAQ from materializing. Could fit naturally into the next docs polish branch (Task #14).

**Decision needed:** Add the warning, or rely on documentation only?

### D3. ElevenLabs `1200` `maxCharsPerRequest` default vs real `~5000` server limit

**Source:** Issue #4 / config sweep.

**Context:** ElevenLabs' actual character limit per request is around 5000 (not officially documented but well-observed). The library defaults to `1200` because Story Loom found that smaller chunks gave better latency/progress granularity. Consumers can already override via `BuildAudioOptions.maxCharsPerRequest`, so this is just a default choice.

**Recommendation:** Keep the conservative default. The reasoning is documented inline in `ELEVENLABS_DEFAULTS`. Consumers who want throughput over latency can bump it. Worth mentioning in the README's "tuning" section before publish.

**Decision needed:** Acknowledge as docs-polish item (D4 here points at this), or change the default?

### D4. Per-package LICENSE files for npm publication

**Source:** B1+B2 (license adoption) note.

**Context:** The repo has a top-level `LICENSE` file (MIT), and each package's `package.json` declares `"license": "MIT"`. npm packages typically also include a per-package `LICENSE` file in their published tarball so the license travels with the install. Currently the `files` array in each package only includes `dist`.

**Recommendation:** Either (a) copy the root `LICENSE` to each package directory and add `LICENSE` to each `files` array, or (b) set up a build step / `release-please` config to do it at publish time. (a) is simpler and works for any package manager.

**Decision needed:** Copy LICENSE per package, or add to release-please workflow?

---

## Bucket 2 — Defer to post-publish (1.x minor)

### D5. HTTP-date form of `Retry-After` header test coverage

**Source:** B1+B2 (error taxonomy) review.

**Context:** `extractRetryAfterMs` in the ElevenLabs adapter parses both seconds (`"30"`) and HTTP-date (`"Wed, 21 Oct 2026 07:28:00 GMT"`) forms. Tests cover the seconds path but not the HTTP-date path. ElevenLabs uses the seconds form in practice; the date branch is defensive code.

**Recommendation:** Add a test in a future docs/cleanup branch. Cheap (~10 lines) and would close a coverage gap.

### D6. `signal.throwIfAborted()` between the two execa calls inside `getAudioDuration`

**Source:** A3 review.

**Context:** `getAudioDuration` runs ffprobe first; if it returns no parseable output, it falls back to ffmpeg's stderr parse. Both calls get `cancelSignal`, but there's no `throwIfAborted()` between them. If the abort fires during ffprobe and ffprobe returns garbage, ffmpeg fallback will still attempt the spawn. The window is small (ffprobe is fast); not a correctness issue, just a small latency-on-abort gap.

**Recommendation:** Add the check opportunistically when the file is next touched. Single line.

### D7. `ElevenLabsClientMock.mockReset()` defensive refactor

**Source:** B1+B2 review, carried forward through every subsequent branch.

**Context:** The mock pattern uses `vi.fn(function () {...})` and then `mockReset()` in `beforeEach`. The reviewer in B1+B2 raised confidence-92 concern that `mockReset()` would wipe the implementation. In Vitest, `vi.fn(impl).mockReset()` actually restores to the original `impl` passed to the constructor — so the tests work correctly. But the pattern is non-obvious; a defensive refactor to `mockClear()` + explicit `mockImplementation()` re-attachment would remove the ambiguity for future test additions.

**Recommendation:** Refactor when the test file is next touched (likely during A6 voice catalog work, which lives in the same provider package). Low priority; current behavior is correct.

### D8a. `parse-complete` has no `onProgress` counterpart

**Source:** A8 (richer events) review.

**Context:** The new lifecycle events fire at 5 points (parse-complete, chunk-start, chunk-complete, stitch-start, stitch-complete). At each point that has an `onProgress` percentage emission, the events fire in the same order. **But** `parse-complete` has no `onProgress` counterpart — when it fires, the percentage is still at 0%. Dual-subscriber consumers (using both `onProgress` and `onEvent`) will see the event without a matching progress tick.

**Recommendation:** Either emit `onProgress?.(0)` immediately before `parse-complete` (cheap, makes the contract symmetric) or document the asymmetry inline. The current state is functionally correct but quietly inconsistent. Lean toward the explicit `onProgress?.(0)` call — it's one line and removes the surprise.

### D8. Pre-existing temp-file collision (`stitcher.ts` `tts_chunk_${i}_${Date.now()}.mp3`)

**Source:** Issue #4 / backlog V4 / config-sweep review.

**Context:** Two concurrent `buildFinalAudio` calls with chunk index 0 landing within the same millisecond write to the same tmp paths. One-line fix: append `Math.random().toString(36).slice(2, 8)` to the filename.

**Status:** Already in Task #13 (verification batch) as V4. Tracked there.

---

## Bucket 3 — Won't do (or wait for v2)

### D9. Real-stereo TTS output

**Source:** A7 review, OPUS_128_STEREO design.

**Context:** The intermediate-audio pipeline is 44.1kHz mono `pcm_s16le` (required for ffmpeg concat-demuxer reliability). Stereo output presets duplicate the mono signal across both channels — technically stereo, no spatial information. Real-stereo would require a different intermediate pipeline (skip concat demuxer, or per-input normalization).

**Disposition:** Not addressing in v1. The limitation is documented inline on the stereo preset. If a real consumer use case for spatial-stereo TTS emerges, it's its own feature, not a config tweak.

### D10. Remove `BuildFinalAudioResult.base64Data`

**Source:** B1+B2 (Buffer return shape).

**Context:** `audio: Buffer` is the primary field; `base64Data: string` is kept and marked `@deprecated` for backward compatibility. JSDoc says "will be removed in v2.0."

**Disposition:** Removal targeted for v2.0. Locked in.

---

## Convention going forward

**During finalize-branch flows:** when the code reviewer flags something deferred (or my own work surfaces a defer-it item), it lands here with a one-line context note + a recommendation. Adding to this doc is part of the session-doc workflow — the act of writing it down forces the "should we just do it now?" question.

**Before npm publish:** sweep Bucket 1 (decide-before-publish). Each item gets a disposition before we tag a release.

**After npm publish:** sweep Bucket 2 (post-publish backlog) opportunistically. Items either get done in 1.x minors or move to Bucket 3 with a documented reason.
