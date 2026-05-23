# 2026-05-23 — Per-call overrides (A1 + A2 + A5)

## Goals

Land three additive per-call options on the orchestration path and on `provider.generate()`, per the digestify decisions on 2026-05-22:

- **A1** — `BuildAudioOptions.pauses?` for multi-tenant pause vocabularies without per-tenant conductors (Media Forge).
- **A2** — per-call voice/settings overrides on `provider.generate()` for A/B testing and slot-versioning use cases (Story Loom).
- **A5** — `BuildAudioOptions.maxCharsPerRequest?` for tuning chunking granularity per call without forking the provider.

All three are backward-compatible additions — no v1.1 consumer should need to change anything.

## Completed Work

### A1 — Per-call pause table override

Added optional `pauses?: Record<string, number>` to `BuildAudioOptions`. In `ttsGenerateFull`, `parseScript` now receives `options.pauses ?? config.pauses`. Tests verify both branches.

### A5 — Per-call maxCharsPerRequest

Added optional `maxCharsPerRequest?: number` to `BuildAudioOptions`. In `ttsGenerateFull`, an effective caps object overlays the call-time value on the provider's declared caps before being passed to `toChunks`. Scope deliberately narrowed to just `maxCharsPerRequest` — `maxInlineBreakSeconds` and `renderInlineBreak` are provider-shape concerns, not per-call knobs.

Defensive: non-positive values (0 or negative) are silently treated as "no override" rather than breaking the chunker. Documented inline and in the JSDoc.

### A2 — Per-call overrides on `provider.generate()`

The structural change here is significant:

- `TtsProvider<TCallOverrides = never>` — generic in the call-override shape, default `never` so existing v1.1 adapters stay source-compatible.
- `TtsProviderFactory<T, TCallOverrides = never>` — parallel generic so the factory's `create()` return type carries through the override shape.
- New `TtsProviderCallOverridesRegistry` interface — parallel module-augmentation target alongside `TtsProviderRegistry`. Providers register their override type here so it flows through the conductor.
- New `CallOverridesFor<T>` derived type — resolves to the override shape for provider `T`, or `never` if not registered.
- `TtsConductor.createProvider` returns `TtsProvider<CallOverridesFor<T>>` (previously unparameterized `TtsProvider`).
- `TtsConductor.registerProvider` accepts the second generic with a default of `CallOverridesFor<T>`.

ElevenLabs adapter:

- New `ElevenLabsCallOverrides` interface exposes `voiceId?`, `voiceSettings?`, `quality?`. `apiKey` deliberately excluded — a different key is conceptually a different provider instance (different billing/quota identity, security boundary).
- Registered in both `TtsProviderRegistry` and `TtsProviderCallOverridesRegistry`.
- `ElevenLabsProvider.generate(chunk, overrides?)` merges call-time overrides ahead of construction-time options.
- `voiceSettings` override is full replacement, not shallow merge. Documented explicitly in the interface JSDoc — passing `{ stability: 0.9 }` drops any other settings from construction time. This keeps the override deterministic across future SDK additions to the voice-settings shape.

### Tests (10 new, suite now 60)

Operations tests:

- A1: per-call pauses passed to `parseScript`; fallback to config pauses
- A5: per-call cap overlays provider caps; fallback to provider caps when omitted

ElevenLabs provider tests:

- A2: voiceId / voiceSettings / quality override each work in isolation
- voiceSettings override is full-replacement (explicitly asserts construction-time `speed` does NOT leak through)
- Symmetry test: overriding only voiceSettings → voiceId and quality fall back

Typed-integration test:

- New guard verifying `conductor.createProvider('11labs', opts).generate(chunk, { voiceId: 'x' })` typechecks through the conductor path. This is the primary documented consumer flow — without this guard the failure mode is silent (overrides still work at runtime but the type erodes to `never`).

## Verification

`bun run check` (typecheck + Biome `--error-on-warnings` + 60 tests) green on the final state.

## Code Review

Dispatched `feature-dev:code-reviewer` against the net diff. Verdict: **"Ready to merge: No, with fixes."** Both important findings addressed:

1. **`ElevenLabsCallOverrides` not exported from `@tts-conductor/provider-elevenlabs/src/index.ts`** (confidence 95). Trivial omission — consumers can use the type via structural typing but can't `import` it by name. Fixed.

2. **`TtsConductor.createProvider` was returning unparameterized `TtsProvider` and erasing the call-overrides generic** (confidence 88). The factory-direct path (`elevenLabsProviderFactory.create(ctx, opts).generate(chunk, overrides)`) worked, but the documented entry point (`conductor.createProvider`) silently lost the override type. Consumers would have had to cast.

   Fixed structurally rather than with a JSDoc note. Introduced a parallel `TtsProviderCallOverridesRegistry` interface and a `CallOverridesFor<T>` derived type. `createProvider` now returns `TtsProvider<CallOverridesFor<T>>`, which flows through cleanly because the ElevenLabs adapter registers itself in both registries via `declare module` augmentation. Storage in `StoredFactory` keeps the runtime erasure (Map can't carry per-key types) but uses `TtsProvider<unknown>` rather than `any`, restoring the typed view via cast in `createProvider`.

   Added a typed-integration test as a compile-time guard so this regression doesn't slip back in silently.

Reviewer's secondary findings (lower confidence, all addressed):

- **`maxCharsPerRequest: 0` was silently accepted** (confidence 82) — changed the condition to `> 0` so non-positive values fall back to the provider's cap. Documented in the JSDoc.
- **`voiceSettings` full-replacement footgun** (confidence 80) — added explicit JSDoc note on the field warning consumers it's full-replacement, not shallow-merge.
- **`voiceSettings` test didn't verify construction-time settings were dropped** (confidence 80) — extended the existing test to assert that `speed: 0.7` from construction does NOT appear in the call args after a `voiceSettings` override. Closes a real gap that would otherwise mask a hypothetical shallow-merge regression.
- **Missing `voiceSettings`-only fallback symmetry test** — added.

Other reviewer notes (no fix needed): backward compatibility of the generic additions is correct (`never` is the right default — preserves v1.1 source compatibility); `apiKey` exclusion from call overrides is the right call (security/billing boundary); A5 narrowing to `maxCharsPerRequest` is the right scope; full-replacement semantic on `voiceSettings` is correct (keeps deterministic across future SDK additions); operations tests for A1/A5 do exercise real source logic (only dependencies are mocked, the override branches are live code).

## Outcomes

The three per-call options are settled with proper typing flowing through the conductor — the primary documented consumer path. ElevenLabsCallOverrides is a public type. Multi-tenant pause vocabularies, A/B voice testing, and per-call chunking tuning are all unlocked without breaking existing consumers.

## Files Modified

- `packages/tts-core/src/config.ts` — added `pauses?` and `maxCharsPerRequest?` to `BuildAudioOptions`
- `packages/tts-core/src/factory.ts` — added `TtsProviderCallOverridesRegistry` + `CallOverridesFor<T>`; extended `TtsProviderFactory` with second generic
- `packages/tts-core/src/provider.ts` — made `TtsProvider` generic in `TCallOverrides`
- `packages/tts-core/src/conductor.ts` — threaded `CallOverridesFor<T>` through `registerProvider` and `createProvider`; switched stored type from `any` to `unknown`
- `packages/tts-core/src/operations.ts` — wired up pause/cap override logic with the `> 0` guard
- `packages/tts-core/src/index.ts` — exported new types
- `packages/tts-core/src/__tests__/operations.test.ts` — A1/A5 tests
- `packages/tts-provider-elevenlabs/src/elevenLabsProvider.ts` — added `ElevenLabsCallOverrides`, registered in both registries, override merge logic in `generate()`, full-replacement JSDoc
- `packages/tts-provider-elevenlabs/src/index.ts` — exported `ElevenLabsCallOverrides`
- `packages/tts-provider-elevenlabs/src/__tests__/elevenLabsProvider.test.ts` — A2 tests + full-replacement assertion
- `packages/tts-provider-elevenlabs/src/__tests__/typed-integration.test.ts` — compile-time guard for the conductor-path typing
- `packages/tts-core/dist/*` — rebuilt for the provider workspace's typecheck

## Follow-ups

- The HTTP-date form of Retry-After in `extractRetryAfterMs` is still untested (carried over from the previous branch). Low priority.
- `ElevenLabsClientMock.mockReset()` defensive refactor (carried over). Still working empirically; can be picked up opportunistically.
- The `TtsProviderRegistry` and `TtsProviderCallOverridesRegistry` being two separate augmentation targets is mildly ergonomic friction. Could be collapsed into a richer shape in a future major (v2) — for now the parallel pattern is the source-compatible path.
