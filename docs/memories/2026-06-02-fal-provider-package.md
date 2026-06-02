# fal.ai TTS provider package (tts-conductor-fal)

**Date:** 2026-06-02

Built `@alien-lobster-buffet/tts-conductor-fal@0.2.0-alpha.0` — one `fal` provider
id parameterized by `model` at construction (marketplace-at-construction; each
instance is one engine). A `FalModelDescriptor` registry (one `buildInput` path +
`flatBuildInput` helper) covers four starter models: minimax/speech-02-hd,
gemini-3.1-flash-tts, chatterbox, elevenlabs/tts/turbo-v2.5. `generate` strips
core's `<speak>`, builds per-model wire input, calls an **instance-local**
`createFalClient` (not the global singleton), does one shared abort-aware fetch of
the returned `audio.url`, and returns `providerMeta: { request_id }`. Duration
native on minimax only; voiceCatalog for gemini only (the one schema-enumerable
voice set). 33 tests; reviewed by kestrel + an independent subagent.

**Key files:** `packages/tts-provider-fal/src/falProvider.ts`,
`packages/tts-provider-fal/src/descriptors/`,
`packages/tts-provider-fal/src/voiceCatalog.ts`

**Docs:** `docs/projects/fal-tts-provider/` (descriptor-design.md +
sessions/2026-06-02-fal-provider-package-session.md). Follow-up: publish to npm
alpha so Media Forge can consume it.
