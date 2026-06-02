# providerMeta core change + fal provider design — 2026-06-02

## Context

Media Forge (consumer, agent "kestrel") asked for a fal.ai TTS provider. fal
isn't one engine — it's a gateway fronting ~31 TTS engines with divergent input
and voice schemas. The whole session ran as a live design collaboration with
kestrel over the `grapevine` channel `fal-tts-provider` (maestro = conductor
side), with Cole steering. Goal: assess feasibility, settle a design that honors
the conductor's deliberately-narrow provider contract, and land the one core
change the design needs.

See [proposal.md](../proposal.md) and [descriptor-design.md](../descriptor-design.md).

## What Happened

**Design convergence (grapevine).** kestrel proposed Option A (one
model-parameterized `fal` provider) vs Option B (provider-family, one id per
model). Landed on **A**, but the unlock was a reframe: _fal-the-package is a
marketplace, but each fal provider instance is still exactly one engine_ — the
marketplace lives at construction time, so core's one-caps/one-generate/one-
voiceCatalog contract is never bent. That dissolved kestrel's "3 broken
assumptions" rather than patching them (per-model caps fall out for free,
non-uniform text key is adapter-internal, voice polymorphism rides the descriptor

- overrides while `voiceCatalog` keeps its narrow meaning).

**The one core change.** Only requirement #3 (surface fal `request_id` for async
cost reconciliation) needed a contract change — the orchestrator was discarding
everything on `GenerationResult` except `{ buffer, duration }`. Added a generic,
opaque `providerMeta` channel: `GenerationResult.providerMeta` → forwarded on the
`chunk-complete` event → aggregated as a chunk-indexed
`Array<Record<string,unknown> | undefined>` on `BuildFinalAudioResult`.

**Key decision — generic list over consumer's literal keys.** kestrel initially
asked core to collect into `request_ids: string[]` (mirroring their image-gen
keys for verbatim cost-path reuse). Cole chose to keep core stricter: an opaque
chunk-indexed list, with MF deriving `request_ids` consumer-side via a one-line
`.map(m => m?.request_id).filter(Boolean)`. Trades "zero glue" for keeping core
free of provider vocabulary — the exact principle that motivated `providerMeta`
over a named `requestId` field. kestrel endorsed ("paying the bill for the
agnosticism I asked for").

**Implementation (TDD).** Wrote 4 failing tests first (event passthrough,
ordered aggregation, sparse/undefined holes, omit-when-empty), watched them fail,
then implemented across provider.ts / events.ts / operations.ts / stitcher.ts.
Additive, no breaking change.

**Two rounds of review.** kestrel reviewed the working tree → "ready to merge"
with two non-blocking notes (index-keyed instead of push for future
parallelism; add an absent-key event test) — both applied. Then the
finalize-branch flow's mandatory independent reviewer (feature-dev:code-reviewer)
flagged a "sparse holes" bug at confidence 88.

## Notable Discoveries

- **The "sparse holes" finding was a false positive — verified empirically.** The
  reviewer claimed `chunkProviderMeta[i] = undefined` leaves sparse array holes.
  It doesn't: explicit index assignment of `undefined` creates a dense own
  property (`0 in arr` → true, `.map` visits it). Sparse holes only come from
  _skipped_ indices, which the sequential loop never produces. Confirmed with a
  `bun -e` repro. No production change made.
- **But the reviewer's adjacent point was fair:** `toEqual([undefined, …])`
  treats holes == undefined, so the test didn't _prove_ denseness. Converted the
  concern into a guard — the sparse-holes test now asserts `.length`, `0 in arr`,
  `2 in arr`, and the documented consumer `.map().filter()` pattern.
- **Mock fidelity:** `buildFinalAudioMock` was missing the required `audio: Buffer`
  field (pre-existing). Added it.
- **fal schema findings (kestrel):** text key diverges (`text` vs gemini
  `prompt`); voice is the real divergence axis (3 of 4 starters need `buildInput`);
  chatterbox `audio_url` is a plain URL string, not a `File` `$ref`.

## Changes Made

- `packages/tts-core/src/provider.ts` — `GenerationResult.providerMeta?`
- `packages/tts-core/src/events.ts` — `TtsChunkCompleteEvent.providerMeta?`
- `packages/tts-core/src/utils/stitcher.ts` — `BuildFinalAudioResult.providerMeta?`
  (chunk-indexed list; populated by the orchestrator, not buildFinalAudio)
- `packages/tts-core/src/operations.ts` — collect per-chunk meta (index-keyed),
  forward on chunk-complete (conditional spread), aggregate + omit-when-empty
- `packages/tts-core/src/__tests__/operations.test.ts` — 5 new tests
- docs: proposal.md + descriptor-design.md (full design for the `-fal` package)

## Lessons Learned

- **Verify reviewer findings, don't reflex-accept.** A confidence-88 "bug" was a
  JS-semantics misconception; a 2-minute `bun -e` repro settled it. But the
  finding still improved the suite — the right move was reject-the-fix,
  keep-the-guard.
- The grapevine collaboration worked well: relaying the design to the consumer in
  real time caught the cost-metadata shape question early and produced the real
  OpenAPI schemas on demand.

## Follow-up

- **Blocked-then-unblocked:** kestrel answered Q3 (fal response shapes) on the
  channel — needed for `extractAudio`/`extractDuration` in the `-fal` package.
  Next session: read msg 15, finalize the descriptor's response handling, build
  the `-fal` package (TDD), starting with the four starter models.
- Q1/Q2/Q4 in descriptor-design.md are review-at-leisure (collapse to single
  buildInput path; multi-speaker chunking scope; typed vs opaque params).
- `audioParts` in operations.ts has the same index-via-push coupling; left as a
  pre-existing pattern (kestrel + reviewer both noted, both said defer).

---

**Related Documents:**

- [Proposal](../proposal.md)
- [Descriptor design](../descriptor-design.md)
- Branch `feature/provider-meta-passthrough` (squash-merged to develop)
- Live design discussion: grapevine channel `fal-tts-provider`
