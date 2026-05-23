# 2026-05-23 — Config audit & centralization sweep

## Goals

Wide-ranging audit of every hardcoded number / magic constant in the codebase. Surfaced mid-A3 when Cole asked "why are these timeouts hardcoded?" — instead of folding the fix narrowly into A3 (would have created scope creep), we backed off and made this a dedicated branch that handles the broader concern: ~20 magic numbers across `tts-core` and the ElevenLabs adapter, classified explicitly (configurable / fixed / named-only), centralized into `defaults.ts`, with a new `TtsRuntimeConfig.timeouts` surface for the configurable subset.

Subsumes backlog item A4 (configurable timeouts) and prepares the scaffolding A7 (output format configurability) will plug into.

## Completed Work

### Classification + centralization

Every magic number now lives in one of two central modules:

`packages/tts-core/src/defaults.ts` (additions):

- `DEFAULT_TIMEOUTS` — 7 timeouts: `generate`, `transcode`, `silenceGen`, `concat`, `concatFilterFallback`, `finalEncode`, `stitch`. Each documented with what it covers.
- `INTERMEDIATE_AUDIO` — 44.1kHz / mono / pcm_s16le. Documented as NOT user-configurable: ffmpeg's concat demuxer requires intermediate-stream consistency. Crackling / hard failures otherwise.
- `DEFAULT_OUTPUT_FORMAT` — libmp3lame / 192k / 44.1kHz / mono. Hardcoded for now; A7 will make per-call configurable.
- `SSML_RESERVE_CHARS` (16) — the chunker's reserve budget for `<speak></speak>` plus inline break tags.
- `DEFAULT_ESTIMATED_BITRATE_KBPS` (128) — `estimateAudioDuration` default.

`packages/tts-provider-elevenlabs/src/elevenLabsProvider.ts`:

- `ELEVENLABS_DEFAULTS` (exported) — `maxCharsPerRequest`, `maxInlineBreakSeconds`, `outputFormat`, `models`. JSDoc classifies each value (consumer-configurable / provider-shape / fixed-with-followup).

### Consumer surface — `TtsTimeouts`

New `TtsTimeouts` interface added to `TtsRuntimeConfig.timeouts?`. Any field left undefined falls back to `DEFAULT_TIMEOUTS` via merge-once at the orchestration boundary:

```ts
const timeouts = { ...DEFAULT_TIMEOUTS, ...(config.timeouts ?? {}) };
```

Consumers can override any subset:

```ts
new TtsConductor({
  pauses: ...,
  timeouts: { generate: 120_000, finalEncode: 90_000 }
});
```

### Refactor

`stitcher.ts` — every `'44100'`, `'1'`, `'pcm_s16le'`, `'libmp3lame'`, `'192k'`, and ffmpeg-timeout literal now reads from a named constant. Filter-graph strings (`channel_layouts=mono`, `sample_fmts=s16`) also derived from `INTERMEDIATE_AUDIO` after code review caught the gap. `genSilenceWav` and `concatParts` gained `timeoutMs` parameters with `DEFAULT_TIMEOUTS.X` defaults. `buildFinalAudio` resolves timeouts once and threads primitives down to all helpers.

`operations.ts` — same merge-once pattern for timeouts, replacing the earlier inline `??` chains (post-review convention fix — having two resolution patterns side by side was a maintenance hazard waiting for the next timeout key).

`chunker.ts` — `- 16` SSML reserve → `SSML_RESERVE_CHARS`.

`duration.ts` — `bitrate = 128` default → `DEFAULT_ESTIMATED_BITRATE_KBPS`.

`elevenLabsProvider.ts` — `CAPS`, model map, and `outputFormat` all read from `ELEVENLABS_DEFAULTS`.

### New exports

- `@tts-conductor/core`: `DEFAULT_TIMEOUTS`, `DEFAULT_OUTPUT_FORMAT`, `TtsTimeouts`
- `@tts-conductor/provider-elevenlabs`: `ELEVENLABS_DEFAULTS`

### Behavior contract

Centralized defaults match prior hardcoded values exactly. All pre-existing tests pass unchanged — this is a no-behavior-change refactor at default settings. Only behavior change introduced: the final-encode now emits `-ac` (post-review fix for the dead-field bug — see below).

## Verification

`bun run check` (typecheck + Biome `--error-on-warnings` + 73 tests) green on the final state. Husky pre-commit gated both commits.

## Code Review

Dispatched `feature-dev:code-reviewer` against the net diff. Verdict: **"Ready to merge: No — with fixes."** One critical bug + two important advisories + one consistency gap + one missing test. All addressed:

**Critical (confidence 90): `DEFAULT_OUTPUT_FORMAT.channels` was defined but never consumed.** The final-encode `execa` call had `-ar` and `-b:a` but no `-ac` flag. Worked correctly today because the intermediate WAV is already mono so ffmpeg inherited the channel count — but when A7 lands and consumers set `channels: 2` for stereo, the encode would silently stay mono. Fix: added `-ac`, `String(DEFAULT_OUTPUT_FORMAT.channels)` to the args. Added a regression test asserting `-ac` is present in the final-encode args.

**Important (confidence 85): Two timeout-resolution patterns in the same pipeline.** `operations.ts` used inline `??` chains (`config.timeouts?.generate ?? DEFAULT_TIMEOUTS.generate`); `stitcher.ts` used merge-once (`{ ...DEFAULT_TIMEOUTS, ...config.timeouts }`). Both correct, but a maintenance hazard — the next person adding a timeout key would have to remember which file used which pattern. Fix: standardized on merge-once in `operations.ts` too. Hoist one `const timeouts = ...` at the entry of `ttsGenerateFull`, replace the `??` chains.

**Important (confidence 82): `channel_layouts=mono` and `sample_fmts=s16` remained as literals in the filter-graph fallback string.** The branch substituted `44100` into `${INTERMEDIATE_AUDIO.sampleRateHz}` but left the layout name and sample format hardcoded. They're coupled to `INTERMEDIATE_AUDIO.channels` and `INTERMEDIATE_AUDIO.codec` — if either changed, the filter string would silently diverge. Fix: added `INTER_CHANNEL_LAYOUT` (derived: `channels === 1 ? 'mono' : 'stereo'`) and `INTER_SAMPLE_FMT` ('s16' for pcm_s16le, with a comment naming the coupling). Substituted into both the filter string and the `anullsrc` filter in `genSilenceWav`.

**Consistency (Q9): `DEFAULT_OUTPUT_FORMAT` was not exported.** `DEFAULT_TIMEOUTS` was exported from `core/index.ts` but `DEFAULT_OUTPUT_FORMAT` wasn't — inconsistent and would block consumers from referencing the default when A7 lands. Fix: exported.

**Missing test (Q7): Partial timeout override.** All custom-timeout tests overrode multiple fields simultaneously. A test that overrides only one field and verifies the rest fall back to `DEFAULT_TIMEOUTS` catches a different class of regression (e.g., a merge-order flip that zeroes out the rest). Fix: added that test.

**Reviewer affirmations (no fix needed):**

- `INTERMEDIATE_AUDIO` classification is correct — concat demuxer needs intermediate consistency, future stereo workflows belong in a separate effort
- Module-level `INTER_*_STR` shorthand is worth it (used in 4 places each)
- `satisfies Record<ElevenLabsQuality, string>` is the right pattern (preserves literal narrowing while enforcing key exhaustiveness)
- `'mp3_44100_128' as const` is sufficient type safety for now; stronger constraints are A7's territory
- Stitcher tests do exercise real source resolution logic (the module is freshly imported each test via `vi.resetModules()`), not just mock plumbing

## Outcomes

Every hardcoded number across the orchestration pipeline is now either (a) consumer-configurable via `TtsRuntimeConfig.timeouts`, (b) a named constant with rationale in JSDoc, or (c) deliberately fixed with inline explanation. A7 (output format configurability) plugs cleanly into `DEFAULT_OUTPUT_FORMAT` — the `-ac` fix ensures the channels field actually controls something.

## Files Modified

- `packages/tts-core/src/defaults.ts` — added 4 new constants with JSDoc classifications
- `packages/tts-core/src/config.ts` — added `TtsTimeouts` interface, `TtsRuntimeConfig.timeouts?`
- `packages/tts-core/src/operations.ts` — merge-once timeout resolution + signal/timeout threading
- `packages/tts-core/src/utils/stitcher.ts` — every magic literal → named constant; `genSilenceWav` and `concatParts` accept timeout params; merge-once at `buildFinalAudio` entry; filter-graph values derived from `INTERMEDIATE_AUDIO`; final-encode `-ac` flag
- `packages/tts-core/src/utils/chunker.ts` — `SSML_RESERVE_CHARS`
- `packages/tts-core/src/utils/duration.ts` — `DEFAULT_ESTIMATED_BITRATE_KBPS`
- `packages/tts-core/src/index.ts` — new exports
- `packages/tts-provider-elevenlabs/src/elevenLabsProvider.ts` — `ELEVENLABS_DEFAULTS`
- `packages/tts-provider-elevenlabs/src/index.ts` — export
- `packages/tts-core/src/__tests__/operations.test.ts` — 1 new test (custom `generate` timeout)
- `packages/tts-core/src/__tests__/stitcher.test.ts` — 4 new tests (defaults applied, full override, partial override, `-ac` present)
- `packages/tts-core/dist/*` — rebuilt for workspace typecheck

## Follow-ups

- **A7 (output format configurability)** is the next branch and plugs into `DEFAULT_OUTPUT_FORMAT`. Consumers will be able to override codec / bitrate / sample rate / channels per call. The `-ac` plumbing is now in place to make this work for channels.
- A 48kHz stereo intermediate-audio workflow would require switching off the concat demuxer (filter-graph for everything, or per-input normalization). Not in scope; flagged for future consideration if a stereo/video-sync use case emerges.
- HTTP-date form of Retry-After in `extractRetryAfterMs` still untested (carried forward).
- `ElevenLabsClientMock.mockReset()` defensive refactor still pending (carried forward).
