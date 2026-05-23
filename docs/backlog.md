# Backlog

Triaged from open GitHub issues as of 2026-05-22. Source issues filed by Cole based on real adoption attempts from [Media Forge](https://github.com/ichabodcole/media-forge) (multi-tenant TTS service) and [Story Loom](https://github.com/ichabodcole/story-loom) (hand-rolled equivalent being evaluated for replacement).

- [#4 — Consumer-integration friction: adoption notes from Story Loom](https://github.com/ichabodcole/tts-conductor/issues/4)
- [#5 — Improvement requests: npm publish, per-call pause override, error taxonomy, usage reporting, and docs](https://github.com/ichabodcole/tts-conductor/issues/5)

Items are sorted by **when** they should be addressed relative to the first public npm publish, because some choices (breaking-shape API changes) get much more expensive after consumers exist.

---

## Already addressed

- ✅ **MIT license** (#4) — done 2026-05-22 (LICENSE file + package.json fields). Was blocking org adoption and CI/security scanners.

## In active work

- 🔧 **npm publish** (#5/1) — covered by Task #5. The GitHub-install workarounds (`bun add github:...`) confirmed broken across machines/CI per #5 follow-up comment. This is the unblock-everything item.

---

## Decide BEFORE first npm publish (breaking-shape window closes after v1.x is on npm)

These change the public API shape. Doing them now is one decision; doing them after npm publication means either a 2.0 or a deprecation cycle.

### B1. `BuildFinalAudioResult` returns `Buffer`, not `base64Data` (#4)

**Confirmed:** `packages/tts-core/src/utils/stitcher.ts:170-175,247` returns `{ base64Data: string, mimeType, size, duration }`. Every realistic consumer (S3, fs writes, BullMQ payloads, HTTP responses) decodes immediately, paying a 33% memory tax. Recommend `audio: Buffer` as primary, drop or keep `base64Data` as optional convenience.

**Decision needed:** Switch the contract now (cheap), or commit to base64 for v1.x and fix in v2 (expensive).

### B2. Provider error taxonomy (#5/5)

Today: `TtsProvider.generate()` throws `Error` on failure. Consumers must regex error messages to classify rate-limit / quota / transient / bad-input. A small exported error hierarchy (`TtsRateLimitError`, `TtsQuotaExceededError`, `TtsTransientError`, `TtsInvalidInputError`) lets consumers `instanceof`-check and retry uniformly. Additive in shape, but the adapter contract changes — every provider must convert SDK errors to these. Easier to bake in now than to retrofit.

**Decision needed:** Define the hierarchy now and update the ElevenLabs adapter, or ship v1.x with raw `Error` throws and add the taxonomy in a minor.

### B3. Output result shape generally (#4, #5/6)

Adjacent decisions that all touch the same return object:

- Optional `usage: { characters?, tokens?, costUnits? }` on `GenerationResult` (#5/6) for multi-tenant billing/observability.
- `BuildFinalAudioResult` reshape (B1 above).

If we're touching the shape anyway, deciding both at once avoids a second wave of churn.

---

## High-value additive (do during v1.x, post-publish OK)

These are backward-compatible additions. Safe to land in minors after the first publish.

### A1. Per-call pause table override on `generateFull` (#5/2)

Add `pauses?: Record<string, number>` to `BuildAudioOptions`; use `options.pauses ?? config.pauses` in `ttsGenerateFull`. The README's "instantiate once, reuse" guidance actively misleads multi-tenant consumers without this. Strictly additive. ~5 lines.

### A2. Per-call voice / settings override on `provider.generate()` (#4)

Slot-versioning use cases need to A/B different voices for the same text without spinning up a new provider. Either `generate(chunk, overrides?: Partial<Options>)` or a fluent `provider.withOverrides(...).generate(...)`. Provider-side change, contract addition.

### A3. AbortSignal plumbing (#4)

Thread an optional `AbortSignal` through `generate()` and `ttsGenerateFull` into the `execa` calls. Lets BullMQ job cancellation, HTTP request aborts, etc. actually stop work. Touches several files but additive.

### A4. Configurable timeouts (#4)

`60s` per-chunk and `45s` per-stitch are hardcoded in `operations.ts` and `stitcher.ts`. Add `TtsRuntimeConfig.timeouts: { generate?, stitch?, silenceGen? }`. Long segments and slow upstream days hit these. Strictly additive with defaults.

### A5. Per-call provider capability overrides (#5/8)

`maxCharsPerRequest` set on instance — consumers tune for latency vs progress granularity. Per-call override on `BuildAudioOptions` lets consumers tune without forking the provider.

### A6. Voice catalog API on the ElevenLabs adapter (#4)

`listVoices(search?, { ttlMs? })` lets consumers drop a parallel ElevenLabs client they're keeping just for the voice picker UI. Provider-package-only change.

### A7. Output format configurability (#4)

`BuildAudioOptions.output?: { codec, bitrate, sampleRate, format }`. Opus for preview, FLAC for archive, variable bitrates. Currently hardcoded 192kbps MP3 in stitcher.

### A8. Richer progress event API (#4)

`onProgress(percent)` → keep, but add `onEvent({ kind, index?, duration?, bytes? })` for SSE-streaming UX (`chunk-start`, `chunk-complete`, `stitch-start`, `stitch-complete`). Existing `onProgress` becomes a thin convenience wrapper.

---

## Verification / hygiene (small, may already be correct)

These are claims worth verifying against current code; some may already be true.

### V1. Voice settings normalization in ElevenLabs adapter (#5/3) — RESOLVED 2026-05-23

**Original framing (preserved for historical context):** "ElevenLabs SDK expects snake_case (`stability`, `similarity_boost`, `style`, `use_speaker_boost`). Consumer code writes camelCase. Adapter should translate; worth confirming against current provider option schema."

**Investigation outcome:** the original diagnosis had the SDK's expectation backwards. The HTTP wire format uses snake_case, but the SDK's TypeScript interface uses camelCase (`similarityBoost`, `useSpeakerBoost`) and handles the wire-level translation internally. Our `ElevenLabsVoiceSettings` interface was the snake_case version — passing snake_case keys to the SDK was silently dropped because the SDK reads `obj.similarityBoost` (undefined) and the `voiceSettings as ElevenLabsTypes.VoiceSettings` cast hid the mismatch.

**Resolution:** renamed `ElevenLabsVoiceSettings` fields to camelCase (`similarityBoost`, `useSpeakerBoost`) to match the SDK exactly. Breaking change to the public interface but pre-publish so free. The cast at the SDK call site is now structurally honest. Updated test fixtures and the package README.

### V2. Stream-to-buffer normalization in adapter (#5/4)

Defensive `chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk)` before `Buffer.concat`. Prevents silent corruption. Worth verifying current `streamToBuffer` in `elevenLabsProvider.ts`.

### V3. Concurrent `parseScript` safety (#4)

Regex with `g` flag retains `lastIndex` across calls if reused. Worth checking `segmenter.ts` for `exec`-in-loop vs `matchAll`. Likely already safe; add a defensive comment/test.

### V4. Temp-file collision under concurrency (#4)

`stitcher.ts:197-198` uses `tts_chunk_${i}_${Date.now()}.mp3` — collisions possible within same ms across concurrent jobs. One-line fix: append `Math.random().toString(36).slice(2)` or UUID.

### V5. `silenceCache` key granularity (#4)

Cache keyed by exact `seconds` — `1.7` and `1.71` don't share. Rounding the key to 0.1s would improve cache hit rate without changing observable behavior.

### V6. Pause-duration upper clamp (#4)

No upper bound today. Adversarial input could request arbitrary silence. Optional `TtsRuntimeConfig.maxPauseSeconds?: number` with no default to preserve current behavior.

### V7. ffprobe-per-chunk cost (#5/10)

Already mitigated by the provider-supplies-duration path. Worth strengthening the provider contract docs that adapters _should_ supply `duration` when the upstream API gives it back.

---

## Docs polish (lowest risk, highest reach)

These are README/docs-only and tend to save every consumer one debugging cycle.

### D1. BullMQ heartbeat pattern (#5/7)

Five-line snippet showing `onProgress` used as `job.updateProgress(percent)` to defeat BullMQ stall detection on long jobs. Saves every consumer one debugging cycle.

### D2. Default model + format guidance for ElevenLabs (#5/9)

Document why `eleven_multilingual_v2` + `mp3_44100_128` beat the turbo models for long-form narration (quality drop is audible). Stops consumers picking the wrong default and discovering it later.

### D3. Debug sink async-safety guidance (#5/12)

Note in README: `saveBuffer`/`saveFile` shouldn't block synthesis. S3-upload-style sinks should fire-and-forget or use a separate IO queue, otherwise total job time goes up by `chunks × upload_latency`.

### D4. Document `parseScript` punctuation/dash fixup (#4)

The segmenter reshuffles trailing dashes / leading punctuation across pause markers. Nice touch, but currently undocumented surprise behavior. Document explicitly, optionally gate behind `parseScript(input, table, { punctuationFixup: true })` (default true).

### D5. Strengthen `renderInlineBreak` extensibility note (#5/13)

Confirmed correct abstraction; just keep it. Worth a "don't regress this" architectural note for future maintainers.

---

## What the library got right (do not regress)

From #5's "what the library got right" section — preserve these through any future change:

- Provider factory pattern with `TtsProviderContext` + module-augmented `TtsProviderRegistry`
- MP3 → WAV → concat → MP3 stitching (direct MP3 concat causes audible clicks)
- `withTimeout` wrapper in `operations.ts`
- `ProcessStage` enum + `DebugMeta` shape (clean enough to repurpose for observability without API churn)
- Both class API and standalone `ttsGenerateFull` export coexisting

---

## Recommended next-step sequence

1. **Decide the breaking-shape items (B1, B2, B3) now** — these are the most expensive to defer. The Buffer-vs-base64 question is the one to settle first; everything else is shape-additive.
2. **Run the small verification batch (V1–V5)** — most are 5-minute checks. Surface anything that turns out to need a fix.
3. **Ship npm publish (Task #5)** — the unblock-everything moment.
4. **Land A1–A4 in a 1.2.0 minor** — per-call pause table, voice override, AbortSignal, configurable timeouts. These cover the most-cited multi-tenant friction.
5. **Docs sweep (D1–D5)** — bundled into a docs-only PR; saves every future consumer time.
6. **Remaining additive items (A5–A8) and V6–V7** — opportunistic; respond to real consumer requests.

---

_Source issues: [#4](https://github.com/ichabodcole/tts-conductor/issues/4), [#5](https://github.com/ichabodcole/tts-conductor/issues/5). Cole authored both as triaged feedback from downstream consumers. PRs welcomed by the original filers for most items._
