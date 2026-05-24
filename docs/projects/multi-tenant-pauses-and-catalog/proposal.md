# Multi-Tenant Pauses & Catalog Factory (alpha.1 bundle)

**Status:** 📝 Draft (2026-05-24)
**Target release:** `@alien-lobster-buffet/tts-conductor-core@0.2.0-alpha.0` + `@alien-lobster-buffet/tts-conductor-provider-elevenlabs@0.2.0-alpha.0`
**Includes breaking change:** Yes — `TtsRuntimeConfig.pauses` → `pauseTable` (see §1 and [Breaking Changes](#breaking-changes))

## Context

`0.1.0-alpha.0` shipped on 2026-05-23. Two alpha consumers have integrated: Story Loom (single-tenant, migration complete on `feature/tts-conductor-migration`) and Media Forge (multi-tenant, in active development). Their feedback converged independently on a small bundle of additive changes — captured in the bridge entry `tts-conductor/triage-2026-05-24` (Socrates) with consumer confirmation from Cherry (Story Loom) and Batman (Media Forge).

This proposal scopes that bundle into a single `alpha.1` release. Everything here is additive and backward-compatible; no consumer of `alpha.0` should need to change code to upgrade.

Items outside this bundle (audio-primitives extraction, `usage` field on `GenerationResult`, polish from Bucket C of the triage) are tracked separately — see [Out of Scope](#out-of-scope).

## Goals

- Unblock Media Forge's multi-tenant story by making the pause table per-call rather than per-conductor.
- Eliminate the duplicate-SDK-dependency trap for any consumer wiring up a voice picker.
- Close two consumer-cycle-cost paper cuts via README updates (BullMQ heartbeat pattern; `maxPauseSeconds` safety guidance for untrusted input).

## Proposed Changes

### 1. Rename `pauses` → `pauseTable` Across `TtsRuntimeConfig` and `BuildAudioOptions` (core)

**Pre-existing state (verified 2026-05-24, post-original-draft).** Alpha.0 _already_ ships both:

- `TtsRuntimeConfig.pauses: Record<string, number>` (construction-time table) — `packages/tts-core/src/config.ts:63`
- `BuildAudioOptions.pauses?: Record<string, number>` (per-call override with full-replace semantics) — `packages/tts-core/src/config.ts:92-103`, resolved at job-start by `effectivePauses = options?.pauses ?? config.pauses` in `packages/tts-core/src/operations.ts:56`, covered by tests at `packages/tts-core/src/__tests__/operations.test.ts:350-367` (A1 fallback + per-call override).

The original draft of this proposal (and the bridge's `tts-conductor/improvements` triage source) treated the per-call override as an additive proposed change. That was an artifact of stale-doc lineage — the work was already in alpha.0; both consumers just hadn't started using the per-call field yet. The verification step originally flagged at the bottom of this section is the one that caught the discrepancy.

**Net change is now a pure rename.** Both fields are ambiguous in the same way (`pauses: { BREATH: 5.0 }` reads as "list of pauses" rather than "lookup table"), and they should stay locked to the same name. Renaming both to `pauseTable` in lockstep:

- `TtsRuntimeConfig.pauses` → `TtsRuntimeConfig.pauseTable`
- `BuildAudioOptions.pauses` → `BuildAudioOptions.pauseTable`
- Internal references: `operations.ts:56` (`effectivePauses` variable name and the resolution expression), `factory.ts` (provider context), test fixtures across both packages.

**Naming rationale.** `pauseTable` makes the shape self-documenting and establishes a `*Table` naming convention for the family of lookup-config blocks this library is likely to grow (future `emotionTable`, voice-trait tables, etc.). Alpha is the right window to make this break — see [Breaking Changes](#breaking-changes). Override semantics are _not_ changing: per-call `pauseTable` continues to fully replace the construction-time table, matching the precedent in `ElevenLabsCallOverrides.voiceSettings` (`elevenLabsProvider.ts:67-75`).

**Consumer migration.** Both alpha.0 consumers (Media Forge, Story Loom) are at most a two-line diff:

- Construction-time rename at the `createTtsConductor({ pauses: ... })` call site.
- Per-call rename (if applicable) at the `buildAudio(..., { pauses: ... })` call site. Story Loom doesn't currently use the per-call field; Media Forge plans to, but hasn't shipped that yet either.

### 2. `createElevenLabsCatalog(apiKey)` Factory (provider-elevenlabs)

**Problem.** `ElevenLabsVoiceCatalog`'s constructor today takes a configured `ElevenLabsClient` instance:

```ts
const client = new ElevenLabsClient({ apiKey });
const catalog = new ElevenLabsVoiceCatalog(client);
```

That forces the consumer to import `@elevenlabs/elevenlabs-js` directly, which means either:

- a duplicate direct dep on the SDK in the consumer's `package.json` (extra coordination on version bumps), or
- reliance on Bun's transitive hoisting to surface the SDK (fragile across CI, version changes, and package-manager swaps).

Cherry kept Story Loom on the duplicate-dep workaround. Batman flagged it as exactly the trap Media Forge's voice-picker admin UI would hit.

**Proposal.** Add a thin factory function to the `-elevenlabs` package:

```ts
export function createElevenLabsCatalog(
  apiKey: string,
): ElevenLabsVoiceCatalog {
  return new ElevenLabsVoiceCatalog(new ElevenLabsClient({ apiKey }));
}
```

This mirrors how the synthesis path already encapsulates the SDK — consumers never import `@elevenlabs/elevenlabs-js` directly to synthesize, and after this change they won't need to to list voices either.

The existing `ElevenLabsVoiceCatalog` class stays exported for the advanced case of "I already have an `ElevenLabsClient` and want to share it."

### 3. README — BullMQ Heartbeat Pattern (core)

**Problem.** Both consumers wired `onProgress` → `job.updateProgress` in their BullMQ workers; both spent a debug cycle figuring out the mapping (Cherry's `job-queue.ts:132-143`). Without the heartbeat, long jobs hit BullMQ's stall detection and get retried mid-synthesis.

**Proposal.** Add a short section to the core README (~5 lines + a code snippet) showing the recommended wiring:

```ts
await conductor.buildAudio(script, {
  onProgress: (percent) => job.updateProgress(percent),
});
```

Plus a one-sentence note about why this matters (stall detection / mid-job retries).

### 4. README — `maxPauseSeconds` Safety Callout (core)

**Problem.** `maxPauseSeconds` lives on `TtsRuntimeConfig` (conductor construction time) with a default of "no clamp." For multi-tenant consumers handling user-authored scripts, this is foot-shooty: a malicious or careless script with `[PAUSE:9999]` becomes an effective denial-of-service via the silence-generation path.

**Proposal.** Add a callout to the core README's "untrusted input" section (creating that section if it doesn't yet exist):

> If your scripts are user-authored or otherwise untrusted, set `maxPauseSeconds` on your `TtsRuntimeConfig` to a sane bound (e.g., 30 seconds). The default is unbounded, which is appropriate for trusted inputs but unsafe for multi-tenant orchestrators.

**Why not change the default?** Changing the default to a finite value would break consumers who legitimately want unbounded pauses (e.g., guided meditation with long contemplative silences — a real Hypnotyche use case). The doc callout is the right shape for the alpha.x line; reconsider before 1.0.

## Out of Scope

**Note on stale framing in upstream docs.** The bridge's `tts-conductor/improvements` entry (now superseded) and the original draft of this proposal both framed the per-call `pauseTable` override as additive work. That framing was an artifact of stale-doc lineage; the override has been in alpha.0 since publication. The §1 rename is therefore the only code change to the pause-table surface in this bundle.

Tracked separately, not part of this bundle:

- **Audio primitives extraction** (`mp3ToWav` / `concatenateAudio` exposed as a standalone `@alien-lobster-buffet/audio-primitives` package). Story Loom is the only consumer with the need today; their 90-line local shim works. Both consumers and Socrates agreed on "wait for a second consumer ask." See bridge entry `story-loom/tts-conductor-migration-learnings` (Story Loom papercut #2).
- **`usage` field on `GenerationResult`**. Batman (Media Forge) provided a v1 shape recommendation: `{ characters: number; provider: string }`. This is the explicitly-deferred item from the 2026-05-23 backlog close-out. Worth its own proposal because it touches the provider contract (every adapter must report usage); not appropriate to bundle into alpha.1.
- **Bucket C polish** from the triage entry — `base64Data` getter, `tier` semantics, ffprobe / parser-regex / debug-sink README notes. Worth picking up in a polish sweep but not blocking any consumer.

## Breaking Changes

Item 1 (renaming `pauses` → `pauseTable` on both `TtsRuntimeConfig` and `BuildAudioOptions`) is a breaking change for any alpha.0 consumer that passes `pauses` to `createTtsConductor` or to `BuildAudioOptions`. Both known alpha.0 consumers are affected:

- **Media Forge.** Per Batman's bridge note: MF's adapter is a one-liner pass-through against whatever field name we ship. He explicitly asked to be pinged before publish so MF and the library bake the same name simultaneously rather than aliasing.
- **Story Loom.** Per Cherry's `feature/tts-conductor-migration` branch: uses construction-time `pauses` via `createTtsConductor({ pauses: { ...DEFAULT_PAUSE_TABLE, HALF_BREATH: 3.0, BREATH: 5.0 } })`. Rename is also a one-liner there.

**Why we're doing it now.** Alpha is explicitly the window for this kind of rename. The cost of locking in `pauses` and then renaming after 1.0 (when third-party consumers exist) is much higher than the cost of pinging two known alpha consumers to update one line each. The `*Table` convention also pre-empts the same conversation we'd have on every future lookup-config block (`emotionTable`, etc.).

**Coordination plan.**

1. Before publish: post a heads-up to the Media Forge bridge naming the resolved field name (`pauseTable`), the version bump (`0.2.0-alpha.0`), and a one-line diff each consumer needs to apply.
2. Hold publish until both consumers acknowledge.
3. Publish `0.2.0-alpha.0` of both packages; post release notes to bridge.

## Impact and Dependencies

**Backward compatibility.**

- Item 1 — **breaking** (rename of `pauses` → `pauseTable` on both `TtsRuntimeConfig` and `BuildAudioOptions`; behavior unchanged).
- Item 2 — **additive** (new exported factory function on `-elevenlabs`; existing `new ElevenLabsVoiceCatalog(client)` path stays valid).
- Items 3, 4 — **README-only**.

**No `peerDependencies` shifts.** `-elevenlabs` already depends on `@alien-lobster-buffet/tts-conductor-core@^0.1.0-alpha.0`; bump the constraint to `^0.2.0-alpha.0` to track the rename.

**Test coverage.** At minimum:

- Rename: update every existing test that touches `pauses` to use `pauseTable`. Existing per-call-override tests (`operations.test.ts:350-367` for the A1 fallback) continue to assert the same behavior under the new field name. The compile-time guard tests in `typed-integration.test.ts` should pin the new field name on both `TtsRuntimeConfig` and `BuildAudioOptions`.
- Catalog factory: happy path (factory returns working catalog instance), error path (missing/empty `apiKey` surfaces a clear error before SDK construction).

**Version bump.** `0.1.0-alpha.0` → `0.2.0-alpha.0` for both packages (minor bump to telegraph the rename break clearly under SemVer-for-alphas conventions). Per-package CHANGELOG.md entries calling out the rename in a **Breaking Changes** subsection. release-please manifest update.

**Publish flow.** Manual `npm publish --tag alpha` from each package directory, per the playbook in Hivemind (`Publishing a Bun workspace to npm (first prerelease)`). The npm CLI cache 404 gotcha is documented there; expect it on `npm view` after publish.

## Decisions Made

1. **Field name: `pauseTable`** (on both `TtsRuntimeConfig` and `BuildAudioOptions`). Resolved 2026-05-24 with Cole. Reasoning: the value is structurally a lookup table mapping pause-marker names to durations; `pauses` reads ambiguously as "list of pauses." The `*Table` suffix makes the shape self-documenting and locks in a naming convention for future lookup-config blocks (`emotionTable`, etc.) that the library is likely to grow. Considered alternatives: `pauses` (status quo, type-meaning-ambiguous), `pauseMap` (collides with JS built-in `Map<K,V>` semantics — value is a `Record`, not a `Map` instance), `pauseOverrides` (loses symmetry with the construction-time field name). Alpha is the right window for the rename.

2. **Override semantics: full replace** (not shallow merge). Already the shipped behavior in alpha.0 — this decision documents and pins the existing semantics rather than introducing them. Matches the `voiceSettings` per-call-override precedent at `elevenLabsProvider.ts:67-75`: deterministic across future field additions, no surprise carryover from construction-time settings. Consumers needing a partial override spread the base table at the call site.

## Open Questions

1. **Catalog factory signature surface.** `createElevenLabsCatalog(apiKey: string)` is the minimum useful surface. Should it also accept the optional `ElevenLabsClient` config (`baseUrl`, custom `fetch`, etc.) that the SDK supports? Lean: start with `apiKey` only; expose `(opts: ElevenLabsClientOptions)` overload only when a consumer asks. Premature flexibility costs API surface.

## Related Documents

- Bridge entry: `tts-conductor/triage-2026-05-24` (this proposal's source-of-truth triage)
- Bridge entry: `story-loom/tts-conductor-migration-learnings` (Cherry's papercut list)
- Bridge entry: `tts-conductor/improvements` — **superseded** by the triage; archived
- 2026-05-23 sessions (`docs/projects/_archive/alpha-0-publish-prep/sessions/`) — context on what shipped in alpha.0
- `docs/backlog/deferred-items.md` — broader deferred backlog (audio primitives, usage reporting, Bucket C polish live here)
