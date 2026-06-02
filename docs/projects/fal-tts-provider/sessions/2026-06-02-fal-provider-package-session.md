# fal provider package build — 2026-06-02

## Context

Second increment of the fal.ai work (the first landed the generic `providerMeta`
core change — see [the prior session](./2026-06-02-providermeta-core-change-session.md)).
This session built the actual `@alien-lobster-buffet/tts-conductor-fal` package
on `feature/fal-provider-package`, implementing
[descriptor-design.md](../descriptor-design.md). Collaboration with kestrel
(Media Forge) continued over the `fal-tts-provider` grapevine channel.

## What Happened

**Unblocked on kestrel's Q3 answers.** The descriptor design needed the fal
_response_ shapes. kestrel's answer (msg 15) drove three concrete refinements
baked into the build:

- All four models return `audio` as a fal `File` (`{ url, content_type? }`) — a
  URL to fetch — so `extractAudio` returns `{ url, mimeType }` and the provider
  does **one shared abort-aware fetch** (mirrors the image adapter), rather than
  each descriptor returning bytes.
- `extractDuration` is minimax-only (`duration_ms / 1000`); the other three fall
  back to core's ffprobe.
- minimax forces `output_format: 'url'` so all four share the schema-confirmed
  fetch path (hex inline bytes deferred as a minimax-only optimization).

**Built TDD.** Descriptors first (pure, easy): `flatBuildInput` helper + the four
descriptors + a `staticVoiceCatalog` for gemini. Then `FalProvider.generate`
(strip `<speak>` → resolve canonical [override wins] → `buildInput` →
`client.subscribe` → shared fetch → `providerMeta: { request_id }`). 28 tests
green, then the review rounds added more.

**voiceCatalog scoped to gemini only.** On contact with the schemas, only
gemini's `voice` is a true enum (30 values). minimax `voice_id` and
elevenlabs-on-fal `voice` are free strings (examples, not enums); chatterbox is
clone-only. Confirmed the gemini-only call with kestrel (msg 18–19) rather than
ship speculative/possibly-wrong static lists.

**Two review rounds.**

1. kestrel reviewed the whole package against the schemas → "ready to merge" with
   one substantive note (char caps) + three micro-notes. Resolved: confirmed
   `maxCharsPerRequest` is per-job overridable (so caps are soft defaults,
   documented as such); made the canonical voice win over a `voice_id` smuggled
   into `params.voiceSetting`; documented gemini's empty `languages`.
2. The finalize-branch mandatory independent subagent review returned "with
   fixes" — see Notable Discoveries.

## Notable Discoveries

- **The independent reviewer's critical finding was real and had a _proper_ fix.**
  Constructing via the global `fal.config()` singleton meant last-write-wins
  across providers with different keys. `@fal-ai/client` exports
  `createFalClient({ credentials })` returning an instance with its own
  `.subscribe` — so each provider now holds an **instance-local client**
  (credentials scoped to the instance), exactly mirroring how the elevenlabs
  adapter uses `new ElevenLabsClient`. The race is gone, not papered over.
- **Abort semantics sharpened.** The catch block previously re-threw the raw
  error whenever `signal.aborted`, which could mislabel a real post-abort API
  error as a cancellation. Now: `isAbortError(error)` propagates; else if
  `signal.aborted`, throw a fresh `AbortError`; else classify. (The elevenlabs
  adapter has the same latent pattern — noted, not changed here.)
- `locateAudio` now throws `TtsError` directly (no double-wrap).

## Changes Made

- New package `packages/tts-provider-fal/` (package.json, tsconfig, tsdown,
  README, LICENSE).
- `src/types.ts` — `FalModelDescriptor`, `FalVoiceSelection` union, `CanonicalTtsInput`.
- `src/descriptors/` — `flatBuildInput`, `shared.locateAudio`, the four model
  descriptors, the `FAL_DESCRIPTORS` registry.
- `src/voiceCatalog.ts` — `staticVoiceCatalog` + the gemini 30-voice catalog.
- `src/falProvider.ts` — `FalProvider` + `falProviderFactory` (instance-local
  client, abort-aware, error mapping).
- 33 tests across `descriptors.test.ts` + `falProvider.test.ts`.

## Lessons Learned

- **Check the dependency's API before accepting an "unsolvable" caveat.** The
  global-singleton limitation looked inherent; `createFalClient` made it a clean
  fix. Worth a 2-minute grep of the package's `.d.ts` before documenting a wart.
- Verifying reviewer findings paid off again: the prior session's "sparse holes"
  was a false positive; this session's "global singleton" was real with a proper
  fix. Same discipline, opposite outcome — that's the point of checking.

## Follow-up

- **Publish gate:** kestrel's MF consumer wiring is blocked on this package being
  **published to npm** (so MF can install it) and on Cole sequencing the broader
  MF tts-discoverability project. So a publish-to-alpha step likely follows the
  merge — Cole's call.
- Error taxonomy: fal errors all map to base `TtsError` for the alpha.
  `@fal-ai/client` exports `ApiError` / `ValidationError` / `isRetryableError` —
  a future pass could classify transient vs invalid-input vs auth.
- Multi-speaker (gemini) is single-chunk/short-form only (documented); chunk-aware
  speaker continuity is deferred per kestrel (Q2).

---

**Related Documents:**

- [Proposal](../proposal.md) · [Descriptor design](../descriptor-design.md)
- [Prior session: providerMeta core change](./2026-06-02-providermeta-core-change-session.md)
- Branch `feature/fal-provider-package` (squash-merged to develop)
- Live design discussion: grapevine channel `fal-tts-provider`
