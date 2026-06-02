# fal.ai TTS Provider (`tts-conductor-fal`)

**Status:** Draft
**Created:** 2026-06-02
**Author:** Cole + maestro (Claude)

> Living draft. The provider shape, the one core change, and the cost-metadata
> alignment are settled. The four starter models' real OpenAPI input schemas have
> landed (see [Related Documents](#related-documents)) and are reflected below;
> the only outstanding schema gap is the `$ref`'d sub-schema bodies (VoiceSetting,
> AudioSetting, SpeakerConfig, File), needed to fully type the object-voice and
> multi-speaker descriptors. We will adjust as those land.

---

## Overview

Add a fal.ai TTS provider to `tts-conductor`, published as a third package
`@alien-lobster-buffet/tts-conductor-fal` alongside `-core` and `-elevenlabs`.

fal.ai is not a single engine like ElevenLabs — it is a **gateway fronting ~31
distinct TTS engines** (minimax ×7, gemini-3.1-flash-tts, xai, qwen, chatterbox,
orpheus, dia, vibevoice, maya, inworld, index-tts-2, kokoro, and a re-hosted
`elevenlabs/tts/turbo-v2.5`), each with its own input shape, "voice" mechanism,
and capabilities. The real work is therefore a **design decision** — how does
the conductor represent a provider that is itself a model marketplace? — plus
exactly **one small, generic core change** and the provider package itself.

The request originates from a real consumer (Media Forge), which wants to offer
fal's TTS catalog to its tenants and to stress-test the TTS surface against a
second, structurally-different provider. See [Related Documents](#related-documents).

## Problem Statement

The current core contract assumes **one provider = one engine**: a single
`caps`, a single `generate(chunk)`, and one optional `voiceCatalog`. fal appears
to break three of those assumptions (evidence from fal's OpenAPI schemas):

1. **Non-uniform input key.** Most engines take `text`; `gemini-3.1-flash-tts`
   takes `prompt`. A fal provider cannot map a chunk to a fixed key.
2. **Polymorphic "voice".** id-based (`elevenlabs`), object-based (minimax
   `voice_setting`), multi-speaker (`gemini` `speakers`), and
   clone-from-reference-audio (`chatterbox` `audio_url`) all coexist. A single
   `voiceCatalog` does not model all four.
3. **Per-model capabilities.** Char limits, multi-speaker, cloning, and design
   vary engine to engine; `ProviderCapabilities` is resolved once per provider
   today.

The consumer additionally needs to attribute fal cost, which is billed
**asynchronously** via a `request_id` reconciled against fal's
`billing-events` endpoint — and there is currently **nowhere in the contract for
a provider to surface a `request_id`** (the orchestrator reduces every
`GenerationResult` to `{ buffer, duration }` before assembling the final result).

## Proposed Solution

### The reframe that resolves assumptions 1–3

**fal-the-package is a marketplace, but each fal provider _instance_ is still
exactly one engine.** A consumer calls:

```ts
const provider = conductor.createProvider("fal", {
  apiKey,
  model: "fal-ai/minimax/speech-02-hd", // selects the engine at construction
  // ...per-model options
});
```

and receives a `TtsProvider` with **one** `caps`, **one** `generate`, and **one**
optional `voiceCatalog` — fully honoring the existing contract. The marketplace
lives at **construction time** (the factory can mint a provider for any
`endpoint_id`), not at the instance level. Consequences:

- **Per-model caps fall out for free.** `caps` is per-instance, and the instance
  is bound to a model, so the adapter sets `caps` from a model table at
  construction. No core change.
- **Non-uniform text key** becomes a pure adapter-internal mapping.
- **Model selection** is just a construction option.
- **One registry id (`'fal'`)** — not 31 module augmentations.

This is **Option A** from the consumer's ask (one model-parameterized `fal`
provider). Option B (one provider id per model) was rejected: ~31
near-duplicate registrations and 31× duplicated `fal.subscribe` plumbing.

### Where the per-model mapping lives: one `FalModelDescriptor`

A single descriptor type per `endpoint_id` that is **data for the simple case,
escape-hatch function for the structurally weird ones**:

```ts
// SHAPE IS ILLUSTRATIVE — voice sub-types pending the $ref'd sub-schemas.
interface FalModelDescriptor {
  endpointId: string;
  caps: ProviderCapabilities; // per-model (incl. maxCharsPerRequest)
  textKey: "text" | "prompt"; // the trivial divergence (gemini = 'prompt')
  defaults?: Record<string, unknown>; // static input, e.g. output_format
  // Escape hatch for structurally weird models. When present, overrides the
  // declarative path entirely and owns voice + param encoding.
  buildInput?: (
    canonical: CanonicalTtsInput,
    overrides?: unknown,
  ) => Record<string, unknown>;
  voiceCatalog?: VoiceCatalog; // only for enumerable-speaker models
}
```

A registry keyed by `endpointId`; the `fal.subscribe` plumbing lives in one place
and is shared across all models.

**What the real schemas revealed.** The text key is a _trivial_ swap (`text` for
minimax/chatterbox/elevenlabs, `prompt` for gemini). The genuine divergence axis
is **voice encoding**, and it's why `buildInput` carries the weight for the
starter set (kestrel chose these four precisely to exercise every mechanism):

| Model                       | text key | voice mechanism                                                                                           | path                          |
| --------------------------- | -------- | --------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `minimax/speech-02-hd`      | `text`   | `voice_setting` **object** (`voice_id` nested, e.g. `Wise_Woman`)                                         | `buildInput` (object nesting) |
| `gemini-3.1-flash-tts`      | `prompt` | `voice` enum (30 presets) **or** `speakers: SpeakerConfig[]` (multi-speaker, 2–10, alias-prefixed prompt) | `buildInput` (multi-speaker)  |
| `chatterbox/text-to-speech` | `text`   | **none** — clone from `audio_url` (File)                                                                  | `buildInput` (clone)          |
| `elevenlabs/tts/turbo-v2.5` | `text`   | `voice` **id** (string) + stability/similarity/style/speed                                                | declarative                   |

So among the _starter four_, three need `buildInput` and only elevenlabs-on-fal
is flat-declarative. That's expected — the broad fal catalog is mostly the flat
`{ text, voice, ...scalars }` shape, so declarative will dominate as we add the
simpler models; the starter set is intentionally `buildInput`-heavy to prove the
escape hatch against the hardest cases first. `gemini`'s `speakers[]` +
natural-language `prompt`-as-delivery is the canonical `buildInput` stress test.

### voiceCatalog stays narrow

`voiceCatalog` keeps its single meaning — "what speakers can I enumerate?" — and
is implemented only for models with an enumerable speaker list. The **input**
polymorphism (object / clone-from-audio / multi-speaker) is encoded by the
descriptor + per-call overrides (`TCallOverrides`), **not** by `voiceCatalog`.
Clone/design models simply leave `voiceCatalog` undefined — exactly the existing
`if (provider.voiceCatalog)` consumer pattern.

### The one core change: generic provider metadata passthrough

Add an optional, **provider-agnostic** metadata channel so async-billing
identifiers (fal `request_id`, and Replicate/others later) can reach the
consumer:

- Add `providerMeta?: Record<string, unknown>` to `GenerationResult`.
- Surface it on the `chunk-complete` lifecycle event (per-chunk) for incremental
  attribution.
- **Aggregate** per-chunk metadata into the final `BuildFinalAudioResult` so
  consumers that don't subscribe to `onEvent` still get it.

Deliberately named `providerMeta` (not `requestId`) to keep core free of any
single provider's vocabulary. Fully additive — no breaking change.

**Cost-metadata alignment (decided with Media Forge).** A TTS job is a
**fan-out**: the script chunks into N `fal.subscribe` calls, each billing its own
`request_id` — structurally identical to how Media Forge's image-gen fans out N
parallel subscribes for models without native batching. MF already sums a _list_
of request_ids (`resolveFalCostMulti` / `combineFalCostResolutions`). To let MF
reuse that path verbatim, core mirrors their exact image keys:

- The fal adapter sets `providerMeta.request_id` (this chunk's id) per
  `GenerationResult`.
- Core aggregates into `providerMeta.request_ids: string[]` (chunk-indexed) on
  the final `BuildFinalAudioResult`, and sets `providerMeta.request_id =
request_ids[0]` for single-id back-compat — matching MF's image
  `{ request_id, request_ids }` shape and its read path (reads `request_ids[]`,
  falls back to `[request_id]`).

Note the difference from image fan-out: TTS chunks run **sequentially** in the
core orchestrator (one `generate()` per chunk), so the adapter does _not_ need
the image side's parallel `AbortController` fan-out bridge — each `generate()` is
one subscribe with the passed `signal`. The aggregation is what unifies the two
shapes, not the execution model.

## Scope

**In Scope (MVP):**

- Core: the `providerMeta` passthrough (GenerationResult → chunk-complete event
  → aggregated into BuildFinalAudioResult).
- New package `@alien-lobster-buffet/tts-conductor-fal`: the `fal` provider
  factory, the `fal.subscribe` plumbing, the `FalModelDescriptor` registry, and
  descriptors for the **four starter models** that exercise every voice
  mechanism:
  - `fal-ai/minimax/speech-02-hd` — object-voice, HD
  - `fal-ai/gemini-3.1-flash-tts` — multi-speaker (`prompt` key)
  - `fal-ai/chatterbox/text-to-speech` — clone-from-audio
  - `fal-ai/elevenlabs/tts/turbo-v2.5` — id-voice (apples-to-apples vs direct 11labs)
- Abort-signal forwarding to `fal.subscribe({ abortSignal })` and the
  error-taxonomy mapping (mirroring the ElevenLabs adapter).

**Out of Scope:**

- The remaining ~27 fal models (add descriptors incrementally once the four
  starter models prove the shape).
- **All Media Forge–side work** — async cost reconciliation branching, the TTS
  model registry, tenant `/voices`, `/models` unification. That rides on top of
  this and is tracked in MF's own backlog/investigation.
- Audio-primitives extraction and any unrelated core refactor.

**Future Considerations:**

- If a third non-SSML provider lands, revisit core's unconditional
  `<speak>…</speak>` wrapping (see [Technical Approach](#technical-approach)).
- Voice-clone / voice-design models (minimax `voice-clone`/`voice-design`) once
  the clone-from-audio input path is validated on chatterbox.

## Technical Approach

- **Provider construction** binds a model; `caps` and the active
  `FalModelDescriptor` resolve at construction from the registry.
- **`generate(chunk, opts)`** strips core's `<speak>…</speak>` wrapper, maps the
  canonical input through the descriptor (declarative or `buildInput`), calls
  `fal.subscribe(endpointId, input, { abortSignal: opts.signal })`, collects the
  audio buffer, sets `duration` from fal's audio metadata when present (avoids
  the ffprobe fallback), and returns the fal `request_id` in
  `providerMeta.requestId`.
- **SSML wrinkle (adapter-side, not a blocker).** Core wraps every chunk as
  `` `<speak>${chunk.ssml}</speak>` `` (`operations.ts:108`) — an 11labs-ism, since
  most fal engines won't accept SSML. The adapter strips the wrapper and sets
  `maxInlineBreakSeconds: null` so the chunker emits no `<break>` tags; long
  pauses already become silence segments via the stitcher. Flagged as a latent
  core wart, handled adapter-side for now. **Dogfood verify-step:** since 11labs
  rendered pauses as inline `<break>` and fal will get stitched-silence segments
  instead, confirm the silence durations are audio-equivalent to what the
  `pauseTable` intends (a verification, not a known concern).
- **Dependencies:** the fal client SDK (`@fal-ai/*`), the existing core error
  classes and `getAudioDuration` helper (already exported), and the
  `TtsProviderRegistry` / `TtsProviderCallOverridesRegistry` augmentation pattern
  used by `-elevenlabs`.

## Impact & Risks

**Benefits:** a large jump in model coverage for consumers; a second,
structurally-different provider that validates the core abstraction; a generic
metadata channel that benefits any async-billing provider.

**Risks:**

- _Descriptor shape churn_ — mitigated by validating against real OpenAPI
  schemas before locking the type, and by dogfooding with Media Forge as first
  consumer.
- _Core change scope creep_ — mitigated by keeping `providerMeta` strictly
  generic and additive.
- _SSML assumption_ — handled adapter-side; noted for a future core cleanup.

**Complexity:** Medium — the core change is small; the complexity is concentrated
in the per-model descriptors and is bounded by starting with four models.

## Open Questions

- **Sub-schema bodies** for `voice_setting` (VoiceSetting), `audio_setting`
  (AudioSetting), `pronunciation_dict` (PronunciationDict), `speakers`
  (SpeakerConfig), and chatterbox's `audio_url` (File) — needed to fully type the
  object-voice (minimax) and multi-speaker (gemini) `buildInput`s. The defaults
  and examples in the artifact are enough to scaffold; exact enums/fields pending.
- **`CanonicalTtsInput` shape** — the canonical fields the descriptor maps _from_.
  At minimum `{ text, voiceSelection }`; needs a voice-selection union expressive
  enough for id / object-id / multi-speaker / clone-from-audio without leaking
  provider specifics into core (these stay provider-side in `-fal`).
- Multi-speaker (`gemini` `speakers`): handled via `buildInput` + a fal-specific
  per-call override type (not a core concept) — **resolved**, validated at impl.

**Resolved:**

- `providerMeta` aggregation shape → chunk-indexed `request_ids: string[]` plus
  `request_id` (first) for back-compat, mirroring Media Forge's image keys so the
  existing `resolveFalCostMulti` cost path is reused verbatim.

## Success Criteria

- A consumer can `createProvider('fal', { model, ... })` for each of the four
  starter models and produce stitched audio through the existing
  `generateFull` pipeline with no fal-specific code in core.
- Per-chunk fal `request_id`s are retrievable both via `onEvent` and on the final
  result.
- Abort, duration passthrough, and per-model char limits all work without core
  changes beyond `providerMeta`.

---

**Related Documents:**

- Media Forge ask: `/Users/colereed/Projects/dreamwood/media-forge/docs/investigations/2026-06-02-fal-tts-conductor-ask.md`
- Media Forge investigation: `/Users/colereed/Projects/dreamwood/media-forge/docs/investigations/2026-06-02-fal-tts-provider-investigation.md`
- Starter-model OpenAPI schemas: `/Users/colereed/Projects/dreamwood/media-forge/docs/investigations/artifacts/2026-06-02-fal-tts-starter-schemas.md`
- Image fal adapter (mirror for `fal.subscribe` / `request_id` / abort): `media-forge/apps/worker/src/handlers/image-gen/providers/fal.ts` (`falCall` L46, abort bridge L116–119, `request_id` capture L201)
- Cost reconcile (MF reuses for TTS-fal): `media-forge/apps/worker/src/sweepers/cost-reconcile.ts` (`resolveFalCost` L136, `resolveFalCostMulti` L196)
- Live design discussion: grapevine channel `fal-tts-provider` (maestro ↔ kestrel)
- Reference adapter: `packages/tts-provider-elevenlabs/src/elevenLabsProvider.ts`

---

## Notes

The provider shape and the `providerMeta` core change were settled in
collaboration with kestrel (Media Forge consumer side) over the grapevine on
2026-06-02. Awaiting the full OpenAPI input schemas for the four starter models
to finalize the `FalModelDescriptor` specifics, plus a pointer to Media Forge's
existing image-gen fal adapter to mirror its `fal.subscribe` / `request_id` /
abort structure.
