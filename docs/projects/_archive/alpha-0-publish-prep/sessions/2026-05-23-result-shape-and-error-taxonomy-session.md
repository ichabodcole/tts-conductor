# 2026-05-23 — Result-shape + error-taxonomy (B1 + B2)

## Goals

- Settle the two breaking-shape decisions that have to close before the first npm publish:
  - **B1:** Return the assembled audio as a `Buffer`, not just a base64 string. Keep `base64Data` as a deprecated convenience.
  - **B2:** Define a `TtsError` hierarchy that consumers can `instanceof`-check, and map the ElevenLabs adapter's SDK errors into it.

Both came out of the open issues #4 (Story Loom adoption notes) and #5 (Media Forge improvement requests). The digestify on 2026-05-22 resolved B1 as "switch to Buffer, keep base64 optional," and B2 as "do now, define plus adapter conversion in lockstep."

## Completed Work

### B1 — `BuildFinalAudioResult.audio: Buffer`

Added `audio: Buffer` as the primary field on `BuildFinalAudioResult`. The pre-existing `base64Data: string` field is kept, marked `@deprecated` with a "will be removed in v2.0" JSDoc note. `stitcher.ts` populates both fields from the same buffer:

```ts
const result: BuildFinalAudioResult = {
  audio: buf,
  base64Data: buf.toString("base64"), // @deprecated
  mimeType: "audio/mpeg",
  size: buf.length,
  duration: durationSec,
};
```

Two stitcher tests added: one verifies `result.audio` is a Buffer with the expected size; one verifies `base64Data === audio.toString('base64')` so the backcompat invariant is locked in.

### B2 — `TtsError` hierarchy in core

New module `packages/tts-core/src/errors.ts` exports six classes:

- `TtsError` (base, unclassified) — `cause?`, `statusCode?`
- `TtsRateLimitError` — adds `retryAfterMs?: number`
- `TtsQuotaExceededError` — subscription / tier exhausted
- `TtsAuthenticationError` — bad / missing API key
- `TtsTransientError` — 5xx / network / timeout (safe to retry)
- `TtsInvalidInputError` — 4xx (do not retry without fixing input)

`TtsAuthenticationError` wasn't in the original backlog item #5/5 (which proposed four classes); added it so consumers can distinguish "fix your credentials" from "fix your SSML" without parsing status codes themselves. Flagged in the PR summary as a small scope expansion.

All six exported from `packages/tts-core/src/index.ts`.

### `withTimeout` now throws `TtsTransientError`

`operations.ts:14` previously threw a generic `new Error(...)` on timeout. Switched to `new TtsTransientError(...)` so a chunk-timeout and an upstream 5xx look the same to consumer retry logic. The stitcher timeout (45s) wraps local ffmpeg work, but `TtsTransientError` is still semantically reasonable — re-running the whole job is the right consumer response either way, and it keeps the timeout path catchable via `instanceof TtsError`.

### ElevenLabs adapter — `mapElevenLabsError`

`elevenLabsProvider.ts` now imports `ElevenLabsError` and `ElevenLabsTimeoutError` from the SDK and runs all caught errors through a `mapElevenLabsError` helper:

```
ElevenLabsTimeoutError                       → TtsTransientError
ElevenLabsError, no statusCode              → TtsTransientError  (network failure shape)
ElevenLabsError, statusCode 401             → TtsAuthenticationError
ElevenLabsError, statusCode 403             → TtsQuotaExceededError
ElevenLabsError, statusCode 429             → TtsRateLimitError + retryAfterMs
ElevenLabsError, statusCode 5xx             → TtsTransientError
ElevenLabsError, statusCode 400/422/other4xx → TtsInvalidInputError
unknown                                      → TtsError (base)
```

The 403→Quota decision is intentional: ElevenLabs uses 403 for subscription-tier exhaustion (not 402 Payment Required). Documented inline.

Retry-After parsing: `extractRetryAfterMs` handles both the seconds form (`"30"`) and the HTTP-date form (`"Wed, 21 Oct 2026 07:28:00 GMT"`). Headers can come as a Fetch `Headers` instance or as a plain record; `readHeader` handles both. Past-date values return `undefined` (after code-review feedback) so callers fall back to their own backoff policy rather than retrying immediately against a server whose clock is probably skewed.

Logger output enhanced: errors now log `kind` (the TtsError subclass name) and `statusCode` alongside the message, so observability tooling can break out error categories.

### Tests — 8 new + 1 follow-up

`elevenLabsProvider.test.ts` grew from 4 to 13 tests:

- One per mapping branch: 401, 403, 429 (with and without Retry-After), 5xx (parameterized over 500/502/503), 4xx (parameterized over 400/422), timeout
- A cause-preservation test
- A `statusCode: undefined → TtsTransientError` test (added post-review to close a coverage gap)

The mock `vi.mock('@elevenlabs/elevenlabs-js')` now also exports `FakeElevenLabsError` and `FakeElevenLabsTimeoutError` — local stand-in classes that mirror the SDK's constructor signatures and `Object.setPrototypeOf(this, new.target.prototype)` pattern. The fakes' shapes are tight enough that the adapter's `instanceof` checks exercise the real mapping branches.

`stitcher.test.ts`: existing `'returns base64 payload'` test reframed to assert on `result.audio` being a `Buffer`; new test verifies the `base64Data ↔ audio.toString('base64')` invariant.

Full suite: 50 tests passing (was 40 before this branch).

## Verification

`bun run check` (typecheck + Biome `--error-on-warnings` + 50 tests) green on every step. Husky pre-commit (`bunx lint-staged && bun run check`) ran green on the commit.

## Code Review

Dispatched `feature-dev:code-reviewer` against the net diff. Verdict: **"Ready to merge: Yes, with fixes."** Three findings, all addressed in a follow-up commit:

1. **`Object.setPrototypeOf` in the fake error classes** (confidence 85) — the real SDK calls `Object.setPrototypeOf(this, new.target.prototype)` defensively for transpiled-ES5 `instanceof` safety. Our fakes didn't. Added it to both fake constructors. Not strictly required at our `target: ES2021`, but cheap defensive symmetry with production.

2. **`extractRetryAfterMs` returning `0` for past HTTP-dates** (confidence 80) — judgment call. Reviewer suggested `undefined` instead (callers fall back to their own backoff). Agreed: a past date almost certainly means server clock skew, and "retry immediately" could hammer an API that hasn't actually cooled down. Changed.

3. **Missing test for `statusCode: undefined → TtsTransientError`** — a real branch in `mapElevenLabsError` that no test exercised. Added.

Reviewer's other notes were informational or "no fix needed":

- `readHeader` correctly handles both Fetch `Headers` instances and plain records; `Array.isArray(value) → value[0]` is right for HTTP semantics.
- `TtsError.cause` re-declaration shadows the native `Error.cause` (TS 4.6+), but the behavior is compatible. Not a bug.
- The status-code routing is complete for all the codes ElevenLabs realistically returns; 404 (bad voice ID), 408 (uncommon — SDK uses `ElevenLabsTimeoutError`), 413 (chunker should have caught), 415, 451 all fall through to `TtsInvalidInputError` correctly.
- `@deprecated` JSDoc on `base64Data` is the right way to signal removal to TS / IDEs; runtime warning would be invasive.

## Outcomes

The two breaking-shape decisions are settled and tested. The library now exposes a Buffer-first result shape (with backcompat-friendly deprecation of the old base64 field) and a small, ergonomic error taxonomy that consumers can `instanceof`-check without parsing message strings. Both surfaces are stable enough to publish to npm. Next: the additive feature branches (A1–A8) can build on this contract.

## Files Modified

- `packages/tts-core/src/errors.ts` — new
- `packages/tts-core/src/index.ts` — export the six error classes
- `packages/tts-core/src/operations.ts` — `withTimeout` throws `TtsTransientError`
- `packages/tts-core/src/utils/stitcher.ts` — add `audio: Buffer`, deprecate `base64Data`
- `packages/tts-core/src/__tests__/stitcher.test.ts` — Buffer + backcompat assertions
- `packages/tts-provider-elevenlabs/src/elevenLabsProvider.ts` — `mapElevenLabsError`, `extractRetryAfterMs`, `readHeader`
- `packages/tts-provider-elevenlabs/src/__tests__/elevenLabsProvider.test.ts` — fake SDK error classes, 8 mapping tests
- `packages/tts-core/dist/*` — rebuilt so the provider workspace can resolve the new core exports during typecheck

## Follow-ups

- `mockReset()` defensive refactor for `ElevenLabsClientMock` (flagged in the prior branch's review, deferred). The current pattern works (49→50 tests still passing) but the failure mode is non-obvious. Worth touching if a future test in this file gets flaky.
- HTTP-date form of Retry-After is not currently exercised by tests; ElevenLabs uses seconds in practice. Could add coverage opportunistically.
- Once v2.0 is on the horizon, drop `base64Data` per the JSDoc deprecation note.
