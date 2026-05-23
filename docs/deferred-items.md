# Deferred Items

A living list of things that came up during implementation, weren't acted on at the time, and need an explicit decision before (or after) the first npm publish. Each item carries a recommendation and a brief rationale.

The convention going forward: when a branch finalizes and the code review flags something deferred, it lands here with a recommendation. We sweep this list before npm publish to make sure nothing slipped through.

Three buckets:

1. **Decide before publish** — small enough to address now or makes a real difference to first-publish quality. Action: pick a disposition (do now / do soon / defer / never).
2. **Defer to post-publish (1.x minor)** — not blocking, can land as additive improvements. Action: leave on the list, address opportunistically.
3. **Won't do (or wait for v2)** — explicit decision not to address. Action: documented here so we don't re-relitigate.

---

## Bucket 1 — Decide before publish

### D1. AAC preset for iOS/Safari delivery — RESOLVED 2026-05-23

**Source:** A7 (output format) review.

**Disposition:** Added `OUTPUT_FORMATS.AAC_128` (native `aac` encoder, `m4a` container, `audio/mp4` MIME). Targets iOS/Safari and Apple Podcasts delivery — the one missing format with a clear Apple-ecosystem answer. ~20 lines + coherence test. `libfdk_aac` left to consumers as a custom-`OutputFormat` escape hatch (GPL-incompatible, rarely shipped in stock ffmpeg).

### D2. Filename-mismatch warning — RESOLVED 2026-05-23

**Source:** A7 review.

**Disposition:** Added a `logger.warn(...)` in `buildFinalAudio` when the consumer-supplied `fileName`'s extension doesn't match `outputFormat.container`. Filename still honored verbatim — renaming the file would be more surprising than the mismatch. Two tests cover the warn-fires and warn-doesn't-fire cases.

### D3. ElevenLabs `1200` `maxCharsPerRequest` default vs real `~5000` server limit

**Source:** Issue #4 / config sweep.

**Context:** ElevenLabs' actual character limit per request is around 5000 (not officially documented but well-observed). The library defaults to `1200` because Story Loom found that smaller chunks gave better latency/progress granularity. Consumers can already override via `BuildAudioOptions.maxCharsPerRequest`, so this is just a default choice.

**Disposition:** Keep the conservative default — confirmed 2026-05-23. The reasoning is documented inline in `ELEVENLABS_DEFAULTS`. Folded into Task #14 (docs polish) as a README "tuning" section item.

### D4. Per-package LICENSE files for npm publication — RESOLVED 2026-05-23

**Source:** B1+B2 (license adoption) note.

**Disposition:** Copied the root `LICENSE` (MIT) to each package directory and added `LICENSE` + `README.md` to each `package.json`'s `files` array. Option (a) from the original recommendation — simpler than wiring release-please, works for any package manager, license travels with the install tarball.

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

### D8c. ElevenLabs adapter known limitations

**Source:** A6 voice catalog review (2026-05-23).

**Context:** Documenting two minor limitations of the ElevenLabs voice catalog mapping, both consequences of how the SDK exposes data rather than bugs in our adapter:

- **`gender` extraction is label-key-sensitive.** ElevenLabs encodes gender as a free-form label (`voice.labels.gender`) rather than a structured field. The adapter reads `voice.labels?.gender` directly. If the SDK ever changes the key casing (e.g., `Gender` capitalized) or a custom voice omits the label, `gender` is undefined. Not a bug — matches the JSDoc contract that `VoiceCatalogEntry.gender` is "free-form because providers don't agree." Worth knowing.

- **`tier` falls back from `recordingQuality` to `category`.** `recordingQuality` describes audio fidelity ("studio"/"good"/"ok"); `category` describes origin ("premade"/"cloned"/"professional"). Picker UIs that care about the distinction should reach into `entry.raw` for `recordingQuality` and `category` separately rather than relying on the conflated `tier` field. Documented in JSDoc on the catalog entry shape.

**Recommendation:** No code change. These are surface-level documentation items — keep them flagged here so if a consumer reports surprising `gender: undefined` results we know where to point them, and if we ever add other provider adapters we can audit whether the same patterns apply.

### D8a. `parse-complete` has no `onProgress` counterpart — RESOLVED 2026-05-23

**Source:** A8 (richer events) review.

**Disposition:** Emit `onProgress?.(0)` immediately before `parse-complete`. Promoted out of Bucket 2 — since the events API is shipping with v1.0, freezing it symmetric now is cheaper than fixing the asymmetry as a behavior change later. One line + one test.

### D8b. `fetchPreview` helper on provider / adapter

**Source:** A6 design conversation (2026-05-23).

**Context:** `VoiceCatalogEntry.previewUrl` is a bare string. Naked-CDN providers (ElevenLabs, PlayHT) return URLs that work directly; auth-gated providers (Cartesia) return URLs that need the same auth as the SDK. Per-adapter docs cover how to fetch.

For consumers who'd rather not write the fetch logic themselves, we could add a `fetchPreview(url, signal?)` helper on the provider (or as a free function exported from each adapter). The provider already has the auth context — it can return a Blob / ArrayBuffer / Buffer the consumer plays directly.

**Recommendation:** Add when a real consumer asks. Pre-emptively adding a method that wraps a 3-line `fetch` call is over-engineering. Re-evaluate once we have actual consumer feedback or once a provider with more complex preview-auth (signed URLs, rotating tokens) joins. Confirmed mutual interest in this on 2026-05-23.

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
