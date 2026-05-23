# Project Manifesto

**Last Updated:** 2026-05-22

## Elevator Pitch

**tts-conductor** is a Node.js library that turns long scripts with timed pauses into single, polished audio files — without locking you to any one text-to-speech vendor. You bring a script, plug in a TTS provider, and the conductor handles the messy middle: parsing pause markers, splitting the script to fit the vendor's character limits, calling the vendor once per chunk, and stitching the audio back together with ffmpeg.

If you've ever tried to render a 20-minute narration through a TTS API that caps you at 5,000 characters per request, you know the problem this exists to solve.

## What It Is

A two-package TypeScript monorepo:

- **`@tts-conductor/core`** — vendor-agnostic orchestration: script parsing, chunking, provider registry, audio stitching. Knows nothing about specific TTS vendors.
- **`@tts-conductor/provider-elevenlabs`** — a concrete adapter implementing the core's `TtsProvider` contract against the ElevenLabs JS SDK.

Adapters are added via a factory + module-augmentation pattern, so new providers slot in with full type safety for their option shapes.

## Target Users

Node.js developers building applications that need **long-form, finalized TTS audio** — anywhere a single TTS API call falls short because the script is too long, needs timed pauses, or wants to be portable across vendors. The shape of the library biases it toward long-form work, but the audience is intentionally broad rather than tied to one genre.

Use cases the maintainer is actively building against:

- Guided visualization and hypnosis content
- Long-form storytelling and narration

Other shapes the library naturally fits:

- Audiobook and narration pipelines
- Voice-over generation for video tools
- Course/educational content rendering
- Sleep, meditation, and breathwork apps

The audience is also people who **don't want to be locked to one TTS vendor** — either because they're benchmarking providers, supporting multiple voices across providers, or hedging against pricing/availability changes.

## What Problem It Solves

Real TTS work hits four friction points that this library absorbs:

1. **Character limits.** Vendors cap requests at thousands of characters; long scripts must be chunked and reassembled.
2. **Pause handling differs by vendor.** SSML `<break>` works on most providers but not all; ElevenLabs accepts `<break>`, Google wants `<break time="...">`, OpenAI's basic API ignores SSML entirely. Pause-table semantics (e.g., "short" = 500ms) belong above the vendor layer.
3. **Audio stitching is annoying.** Concatenating MP3 buffers losslessly requires ffmpeg gymnastics most app developers don't want to write.
4. **Vendor lock-in is the default.** Most TTS code is written directly against one SDK; swapping providers means a rewrite.

The conductor's bet is that these four things are stable enough to live in shared infrastructure, even as the vendor landscape churns.

## Core Principles

These are discovered from the code, not declared in advance:

- **The core knows nothing about vendors.** `@tts-conductor/core` has zero TTS-vendor imports. Every vendor-specific concern lives in an adapter package.
- **Trust the provider when it knows more.** `GenerationResult.duration`, `mimeType`, and `size` are optional. If a provider supplies duration, the core skips an expensive ffprobe call. The contract rewards adapters that do their own work.
- **Provider identity flows through context, not constructors.** Factories declare a typed `id`; the conductor stamps that ID onto `TtsProviderContext` at creation; providers assign `this.id = ctx.id`. No unsafe casts, no duplicated bookkeeping.
- **Small contracts over big surfaces.** `TtsProvider` is three fields: `id`, `caps`, `generate()`. The whole orchestration runtime is ~450 lines of source. New adapters cost very little to write.
- **Vendor-native pause syntax is opt-in.** Providers default to SSML `<break time="Xs"/>`, but can supply `renderInlineBreak(seconds)` to emit whatever the engine expects (e.g., custom `<mark>` tags). The core picks the right syntax per provider.
- **Type-safe registration via module augmentation.** Adapters extend `TtsProviderRegistry` so `conductor.createProvider('11labs', opts)` gives full IntelliSense and compile-time option validation. No string-typed config bags.
- **Debug is opt-in and zero-cost when off.** If no debug sink is configured, the debug path is dead code.
- **ffmpeg is a load-bearing dependency, not abstracted away.** The library targets server-side Node with ffmpeg/ffprobe available. It does not try to be runtime-portable.

## What It Doesn't Do

These boundaries are real and observable in the code:

- **Streaming TTS.** The conductor produces a final file. There is no streaming API; chunks are buffered and stitched at the end. Streaming is not on the near-term roadmap, though it isn't permanently ruled out either.
- **Browser / client-side rendering.** `ffmpeg-static` and `execa` are Node-only.
- **Voice cloning, voice management, or model training.** Anything vendor-specific stays in the adapter; the core doesn't model voices.
- **Script authoring UI.** Input is plain text with inline pause markers. No editor, no preview tool, no validation beyond parsing.
- **Real-time / interactive dialog.** This is a one-shot rendering library, not a conversational TTS runtime.
- **Caching, persistence, or job queues.** Each `generateFull` call runs synchronously to completion; restart-tolerance and dedup are the consumer's problem.
- **Network reliability beyond a 60s per-chunk timeout.** There's no retry policy, no rate-limit handling, no backoff. Adapters or callers handle these if they want them.

## Design Philosophy

The repo behaves like extracted infrastructure, not speculative architecture. Specifically:

- **Interfaces tighten over time.** The 2025-09-29 interface-alignment proposal trimmed redundant work and made metadata optional. The trajectory is toward smaller, more trusting contracts — not toward bigger ones.
- **One way to do things.** The session notes mention a previous "typed API" surface that was removed in favor of a single unified API. Surface area is actively pruned.
- **Tooling polish gets first-class attention.** A lot of the commit history is build/lint/release infrastructure (tsup→tsdown, Turbo v2, release-please, Husky). The maintainer treats devex as part of the product.
- **Pause tables are configuration, not code.** The default pause table is exported (`DEFAULT_PAUSE_TABLE`) but consumers can pass their own. Semantic pause names ("short", "medium", "long") aren't baked into the library.
- **No premature multi-tenancy.** The conductor is a regular class you instantiate once per app. No singleton magic, no service-locator pattern.

## Status

**Active: preparing for public npm release.** The repo is already public on GitHub; the current focus is the prep work to publish `@tts-conductor/core` and `@tts-conductor/provider-elevenlabs` to npm. Both packages are at v1.1.0 with release-please wired up, the license is MIT, and one adapter exists and works. Last code commit was 2025-11-20, but the release-prep work is in flight as of 2026-05-22.

---

## Detective's Notes

Non-obvious observations from reading the code, docs, and history:

**The contract has only been validated against one vendor.** ElevenLabs is the only existing adapter. Several design choices — particularly the `renderInlineBreak` opt-in and the optional metadata fields — anticipate variations the maintainer hasn't actually hit yet. Adding a second adapter (Azure, Google, OpenAI) is the cheapest way to find out which assumptions are real and which are wishful. Until then, the core↔provider contract is theoretically vendor-agnostic and practically ElevenLabs-shaped.

**The repo was likely extracted, not designed.** The parent directory `Hypnotyche` and the polish of the contract (optional metadata, debug sinks with job IDs, ffmpeg as a first-class concern) read like "lessons learned from a real production app, lifted into reusable form." This is a strength — the design has been pressure-tested by at least one real consumer — but also means the manifesto-level question "who else needs this" is genuinely open.

**The dormancy was the lull before publication.** Six months without code commits, but as of 2026-05-22 the maintainer is actively prepping for npm publish. The license change to MIT and README cleanup are part of that prep — what looked like "stalled before public launch" is actually "queued for public launch." Expect the next round of changes to be publication-shaped (package metadata, repository fields, READMEs, install instructions, possibly a top-level usage example).

**Pause tables are an underexposed feature.** `DEFAULT_PAUSE_TABLE` and the ability to inject custom pause tables is a quiet but powerful design choice — it lets consumers define their own pause vocabulary ("breath", "long-pause", "transition") without the library prescribing one. This isn't featured in the README and could be one of the more interesting selling points for hypnosis/meditation use cases specifically.

**Provider-level debug metadata is a real escape hatch.** The debug sink accepts arbitrary metadata, and providers can stamp their own fields (`latency`, `requestId`, etc.) onto debug outputs. For anyone running TTS through a queue or doing latency analysis across providers, this is more useful than it looks.

**Forward-looking scope.** The maintainer flagged that the library may eventually grow beyond pure TTS — dynamically generated sounds from text descriptions is one direction mentioned. Today the contract is strictly text-in / audio-out per chunk, but the chunk-and-stitch pipeline isn't fundamentally married to speech. Worth holding loosely; the surface today is TTS-shaped, and any expansion is a future decision.

**Potential directions that fit the philosophy:**

- A second adapter (Azure / Google / OpenAI / Cartesia) — would validate the contract generalizes beyond ElevenLabs.
- A "passthrough" or "fixture" provider for tests — implementations using this library currently have to mock the whole adapter; a fake provider in core's test utilities could lower that cost.
- npm publication prep (the active work): repository metadata in package.json, public-facing READMEs with install instructions, possibly a top-level example, CHANGELOG visibility, and confirming release-please is configured for public publishing.

**Tensions worth surfacing:**

- The library has v1.1.0 release tooling but no published packages and no public usage. "v1" implies stability commitments that haven't been tested against external consumers yet — worth thinking about whether the contract is truly frozen before npm visibility makes breaking changes more expensive.
- The README is correct and useful but talks about the conductor as if multiple providers exist ("Reuse this instance to register factories and create providers across your app"). With only one adapter today, that framing is forward-looking — accurate for the design, but consumers landing on npm will only see one provider listed.
