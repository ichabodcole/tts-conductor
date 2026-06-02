# Generic providerMeta passthrough in core (for fal cost reconciliation)

**Date:** 2026-06-02

Added a generic, provider-agnostic per-chunk metadata channel to core so
providers can surface opaque data (e.g. a fal `request_id` for async cost
reconciliation) without core learning provider vocabulary: `providerMeta?` on
`GenerationResult`, forwarded on the `chunk-complete` event, and aggregated as a
chunk-indexed `Array<Record<string,unknown> | undefined>` on
`BuildFinalAudioResult` (populated by the orchestrator, not `buildFinalAudio`;
omitted entirely when no chunk supplies any). Additive, no breaking change.
First consumer: Media Forge's forthcoming `-fal` provider, which derives
`request_ids` consumer-side via `providerMeta?.map(m => m?.request_id).filter(Boolean)`.

**Key files:** `packages/tts-core/src/provider.ts`,
`packages/tts-core/src/events.ts`, `packages/tts-core/src/utils/stitcher.ts`,
`packages/tts-core/src/operations.ts`

**Docs:** `docs/projects/fal-tts-provider/` (proposal.md, descriptor-design.md,
sessions/2026-06-02-providermeta-core-change-session.md)
