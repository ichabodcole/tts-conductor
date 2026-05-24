# 2026-05-23 — AbortSignal plumbing (A3)

## Goals

End-to-end cancellation support so consumers (BullMQ workers, HTTP handlers, etc.) can stop in-flight TTS jobs cleanly. Per `docs/backlog.md` item A3 and the digestify decisions on 2026-05-22.

## Completed Work

### Shape reshape — `TtsProvider.generate()` second arg

The previous branch (A2) shipped `generate(chunk, overrides?: TCallOverrides)` — a flat per-call overrides arg. For A3 to add a signal, the choices were:

- **Third positional**: `generate(chunk, overrides?, signal?)` — awkward `undefined` middle when only signal is passed.
- **Options object**: `generate(chunk, options?: GenerateCallOptions<TCallOverrides>)` where `GenerateCallOptions = { overrides?, signal? }`.

Picked the options object. Pre-publish, so the breaking contract change is free; reshaping after npm publish would be much more expensive. The shape also scales better as we add more per-call concerns later. All A2 call sites in tests were updated to the new `{ overrides: { ... } }` shape. New `GenerateCallOptions<T>` exported from core.

### `BuildAudioOptions.signal?: AbortSignal`

Added to the orchestration-level options. Conductor-side cancellation lifecycle: when the signal aborts, the orchestrated job rejects with `AbortError`. Any chunk already in progress completes its current await before unwinding.

### Threading

`ttsGenerateFull` threads `options.signal` to:

- `signal.throwIfAborted()` at orchestration entry (bail before parseScript)
- `signal.throwIfAborted()` between chunks in the loop (bail before next upstream call)
- `provider.generate(input, { signal })`
- `getAudioDuration(buffer, ffmpegConfig, logger, signal)` (new 4th param)
- `buildFinalAudio(config, chunks, audio, fileName, { signal })`

`buildFinalAudio` threads signal into:

- `signal.throwIfAborted()` at entry and per-chunk in the loop
- Every `execa(...)` call via execa v9's `cancelSignal` option
- `concatParts()` (new `signal?: AbortSignal` arg) → its execa calls
- `genSilenceWav()` (new `signal?: AbortSignal` arg) → its execa call

`concatParts` got signal-aware error handling: if the abort fires during the concat-demuxer attempt, the filter-fallback retry is skipped (don't "try harder" when the consumer said stop).

`ElevenLabsProvider.generate`:

- `signal.throwIfAborted()` at entry
- SDK's `client.textToSpeech.convert(voiceId, request, { abortSignal: signal })` (BaseRequestOptions third arg)
- `getAudioDuration(buffer, ..., signal)` for the duration call

### Tests (8 new, suite now 68)

- ttsGenerateFull throws `AbortError` immediately when given a pre-aborted signal (parseScript not called)
- ttsGenerateFull forwards signal to provider.generate
- ttsGenerateFull forwards signal to getAudioDuration when provider omits duration
- ElevenLabsProvider forwards signal as `abortSignal` to the SDK's textToSpeech.convert call
- ElevenLabsProvider throws `AbortError` immediately when given a pre-aborted signal (convertHandler not called)
- ElevenLabsProvider propagates a mid-flight AbortError instead of wrapping it in TtsError (post-review fix)
- buildFinalAudio throws AbortError immediately when given a pre-aborted signal (no ffmpeg spawn)
- buildFinalAudio forwards `cancelSignal` to every execa call

## Verification

`bun run check` (typecheck + Biome `--error-on-warnings` + 68 tests) green on the final state. Husky pre-commit gates ran green on the commits.

## Code Review

Dispatched `feature-dev:code-reviewer` against the net diff. Verdict: **"Ready to merge: No — with fixes."** Two critical bugs and one important test gap. All addressed:

**Critical #1 (confidence 97): AbortError swallowed and re-wrapped as TtsError.**

`mapElevenLabsError` only checks for `ElevenLabsTimeoutError` and `ElevenLabsError` — a native `AbortError` thrown by the SDK or by getAudioDuration during a mid-flight abort matches neither, so it fell through to `new TtsError(...)`. Consumers checking `err.name === 'AbortError'` to distinguish cancellation from failure would have misclassified every mid-stream abort as a generation failure (spurious retries, error counters, log spam).

Fixed by adding an abort guard at the top of the catch block:

```ts
} catch (error) {
  if (signal?.aborted || isAbortError(error)) {
    throw error;
  }
  // ... existing mapping ...
}
```

New `isAbortError` helper detects both `DOMException` aborts (modern Node fetch) and Node-style `name === 'AbortError'` errors (execa, older runtimes).

**Critical #2 (confidence 85): `genSilenceWav` had no signal plumbing.**

`buildFinalAudio` threaded signal correctly to its own execa calls but called `genSilenceWav(pauseSeconds, ffmpegConfig, logger)` without it. On a cache-miss (uncached pause duration), the ffmpeg spawn ran with only a 30-second timeout — meaning an abort during silence generation hung for up to 30 seconds before unwinding.

Fixed by threading `signal?: AbortSignal` through `genSilenceWav`'s signature and into its execa `cancelSignal` option.

**Important #3 (confidence 80): Pre-aborted tests asserted only that something was thrown, not the error type.**

Both pre-abort tests used `.rejects.toThrow()` — a regression that wraps abort into TtsError (the exact bug Critical #1 fixed) would silently pass. Strengthened to `.rejects.toMatchObject({ name: 'AbortError' })`. Also added a positive test for Critical #1: a mid-flight abort scenario that should propagate as AbortError, not wrap.

**Additional coverage:**

Reviewer flagged that `stitcher.test.ts` had no abort tests despite `buildFinalAudio` gaining the most signal plumbing in this branch. Added two:

- Pre-aborted signal throws AbortError without spawning ffmpeg
- Every execa call receives `cancelSignal: signal`

**Other reviewer findings (no fix needed, defensible as-is):**

- `concatParts` abort-vs-fallback logic is correct: skipping the filter-fallback when signal aborted is the right behavior.
- execa `cancelSignal` sends SIGTERM, which ffmpeg handles gracefully. Temp file cleanup via the existing `cleanupTempFiles` + finally pattern covers the abort path.
- `signal.throwIfAborted()` placements are correct (entry-of-orchestration, between chunks, entry-of-provider, entry-of-stitcher).
- The options-object shape reshape was the right call.

## Outcomes

End-to-end AbortSignal is wired through every meaningful await point: parsing, chunking, provider calls, ffprobe, ffmpeg transcode, concat, final encode. Consumers can now cancel a job cleanly and receive a native AbortError (not a wrapped TtsError) so they can distinguish cancellation from failure.

## Files Modified

- `packages/tts-core/src/provider.ts` — `GenerateCallOptions<T>` + reshaped `TtsProvider.generate` signature
- `packages/tts-core/src/config.ts` — `BuildAudioOptions.signal?`
- `packages/tts-core/src/operations.ts` — signal threading + entry/between-chunk abort checks
- `packages/tts-core/src/utils/duration.ts` — `getAudioDuration` accepts signal, threads to ffprobe/ffmpeg execa
- `packages/tts-core/src/utils/stitcher.ts` — buildFinalAudio threads signal to all execa calls, concatParts and genSilenceWav signatures + signal-aware fallback skip
- `packages/tts-core/src/index.ts` — export `GenerateCallOptions`
- `packages/tts-core/src/__tests__/operations.test.ts` — 3 new abort tests + signature updates
- `packages/tts-core/src/__tests__/stitcher.test.ts` — 2 new abort tests
- `packages/tts-provider-elevenlabs/src/elevenLabsProvider.ts` — accept new options shape, forward signal to SDK, abort-aware catch + isAbortError helper
- `packages/tts-provider-elevenlabs/src/__tests__/elevenLabsProvider.test.ts` — 3 new abort tests + A2 test shape updates
- `packages/tts-provider-elevenlabs/src/__tests__/typed-integration.test.ts` — shape update
- `packages/tts-core/dist/*` — rebuilt for workspace typecheck

## Follow-ups

- Audio format constants (sample rate, bitrate, channel count, codec choices) are still hardcoded throughout `stitcher.ts`. Tracked under Task #9 (configuration audit and centralization sweep) which absorbs A4 and prepares for A7.
- HTTP-date form of Retry-After in `extractRetryAfterMs` still uncovered by tests (carried forward from earlier branches). Low priority.
- `ElevenLabsClientMock.mockReset()` defensive refactor (carried forward). Still working empirically.
- The reviewer noted there could be a `signal.throwIfAborted()` between the two execa calls inside `getAudioDuration` (ffprobe → ffmpeg-fallback). Minor; the time budget for that path is small. Deferred.
