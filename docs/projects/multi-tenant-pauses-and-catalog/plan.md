# Plan: Multi-Tenant Pauses & Catalog Factory (alpha.1 bundle → published as `0.2.0-alpha.0`)

**Source proposal:** `./proposal.md`
**Status:** 📝 Draft (2026-05-24)
**Branch:** to be created — recommend `feature/alpha-0.2-pause-table-rename` from `develop`
**Reviewer (post-implementation):** Socrates (final review before publish)

## Overview

Ship `0.2.0-alpha.0` for both `@alien-lobster-buffet/tts-conductor-core` and `@alien-lobster-buffet/tts-conductor-provider-elevenlabs`. Three substantive changes:

1. **Rename** `pauses` → `pauseTable` on both `TtsRuntimeConfig` and `BuildAudioOptions`. Behavior unchanged. Both alpha.0 consumers (Media Forge, Story Loom) acked the breaking change on the bridge (thread `e96ee646-b14c-4bb2-9ce8-9c9238aa73a8`).
2. **Add `createElevenLabsCatalog(apiKey: string)`** factory to `-elevenlabs`, removing the consumer-side duplicate-SDK-dep trap.
3. **README updates** to core: BullMQ heartbeat snippet, `maxPauseSeconds` untrusted-input callout.

Plus the release mechanics: CHANGELOG entries, version bumps, peerDep constraint update, manifest sync, manual `npm publish --tag alpha`, release-notes post to the bridge.

## Outcome & Success Criteria

Done when:

- [ ] `bun run check` is clean across the monorepo (typecheck + lint + tests).
- [ ] No remaining references to `pauses` (as a field name) in source or tests, except inside README context where the rename is being explained.
- [ ] `createElevenLabsCatalog(apiKey)` is exported from `-elevenlabs` and reachable from a downstream consumer using only the published package (no transitive SDK import required).
- [ ] Both packages publish cleanly with `npm publish --tag alpha`, version `0.2.0-alpha.0`.
- [ ] `npm view @alien-lobster-buffet/tts-conductor-core@0.2.0-alpha.0` returns the new version (after the cache-clean step from the Hivemind playbook).
- [ ] Bridge release-notes message posted to thread `e96ee646-b14c-4bb2-9ce8-9c9238aa73a8`.

## Approach Summary

This is a small, low-risk PR: pure rename + small additive factory + doc updates + release mechanics. The plan splits into phases by **commit boundary**, not by complexity — each phase is one atomic commit. TDD applies to Phase 3 (new factory function); the rest is verify-after-rename.

Pre-implementation state already verified by Socrates: `BuildAudioOptions.pauses` per-call override already exists in alpha.0 with full-replace semantics — the original proposal had it framed as additive work, which the corrected proposal now reflects. The implementer should not need to add the per-call override surface; only rename it.

## Phases

### Phase 1 — Rename in `tts-core`

**Goal.** Rename `pauses` to `pauseTable` everywhere it appears as a field name in core source and tests. Behavior unchanged.

**Files to modify (core source):**

- `packages/tts-core/src/config.ts` — line 63 (`TtsRuntimeConfig.pauses` → `pauseTable`), line 103 (`BuildAudioOptions.pauses?` → `pauseTable?`). Update the doc comments at lines 73-89 and 94-102 to reference `pauseTable`.
- `packages/tts-core/src/operations.ts` — line 56 (`effectivePauses = options?.pauses ?? config.pauses` → `effectivePauseTable = options?.pauseTable ?? config.pauseTable`). Rename the local variable for consistency. Update any downstream pass-through to `parseScript`.
- `packages/tts-core/src/factory.ts` — check if it constructs `TtsRuntimeConfig` literals; rename field references.
- Any other internal references that the grep at `packages/tts-core/src` surfaces.

**Files to modify (core tests):**

- `packages/tts-core/src/__tests__/stitcher.test.ts:34`
- `packages/tts-core/src/__tests__/factory.test.ts:25`
- `packages/tts-core/src/__tests__/typed-conductor.test.ts:38`
- `packages/tts-core/src/__tests__/config.test.ts:7,16,23` (touches both the literal and the readback via `config.pauses.SHORT`)
- `packages/tts-core/src/__tests__/operations.test.ts:34,89,350-367,427` (test fixtures + the A1 fallback tests). The test descriptions referencing "per-call pauses" / "runtime-config pauses" should be updated to "per-call pauseTable" / "runtime-config pauseTable" for clarity.

**Tests already exist for the behavior being preserved** — no new tests needed in this phase; the existing tests are the regression guard.

**Step-by-step:**

1. From the repo root: `bun run check` — baseline; should pass.
2. Apply renames to core source files (config.ts, operations.ts, factory.ts).
3. `bun run --filter @alien-lobster-buffet/tts-conductor-core check-types` — expect failures in core tests still using `pauses`.
4. Apply renames to all core test files.
5. `bun run --filter @alien-lobster-buffet/tts-conductor-core check-types` — expect pass for core.
6. `bun run --filter @alien-lobster-buffet/tts-conductor-core test` — expect all tests pass.
7. **Verify:** `grep -rn "pauses" packages/tts-core/src` — should return zero hits _as a field name_ (matches inside README context comments or in the word "pauses" used as English prose are fine; the goal is no `.pauses` accesses or `pauses:` object-key usages).
8. Commit: `refactor(core): rename pauses → pauseTable for type-meaning clarity` (no body needed; the rename is self-evident).

### Phase 2 — Rename in `tts-provider-elevenlabs`

**Goal.** The `-elevenlabs` package's own tests construct `TtsRuntimeConfig` literals and break at the type level after Phase 1. Sweep those.

**Files to modify:**

- `packages/tts-provider-elevenlabs/src/__tests__/typed-integration.test.ts:7`
- `packages/tts-provider-elevenlabs/src/__tests__/elevenLabsProvider.test.ts:94` (the `overrides.pauses ?? {}` fallback in the test helper — rename to `overrides.pauseTable ?? {}` and rename the helper's `pauses` parameter to `pauseTable` if applicable).
- `packages/tts-provider-elevenlabs/src/__tests__/factory.test.ts:9`

**Source files in `-elevenlabs` do not need changes** — `elevenLabsProvider.ts` and `voiceCatalog.ts` don't reference the `pauses` field directly (verified by the earlier grep — all hits in the elevenlabs package were in tests or in unrelated word-prose comments like "Longer pauses get rendered as separate silence segments" at line 120, which can stay as English prose since it's not a field reference).

**Step-by-step:**

1. Apply renames to elevenlabs test files.
2. `bun run check` from repo root — full monorepo gate.
3. **Verify:** `grep -rn "pauses" packages/tts-provider-elevenlabs/src` — only the English-prose comment at `elevenLabsProvider.ts:120` should remain. No field accesses.
4. Commit: `refactor(11labs): rename pauses → pauseTable in test fixtures (follow Phase 1)`.

### Phase 3 — `createElevenLabsCatalog` factory (TDD)

**Goal.** Add a top-level factory that encapsulates the SDK client construction. Consumers should be able to do `import { createElevenLabsCatalog } from '@alien-lobster-buffet/tts-conductor-provider-elevenlabs'` without ever importing `@elevenlabs/elevenlabs-js`.

**Files to create / modify:**

- Modify: `packages/tts-provider-elevenlabs/src/voiceCatalog.ts` — add the factory function at module scope (alongside `ElevenLabsVoiceCatalog` class). Reuses the existing `ElevenLabsClient` import.
- Modify: `packages/tts-provider-elevenlabs/src/index.ts` — export the factory.
- Create or extend: `packages/tts-provider-elevenlabs/src/__tests__/voiceCatalog.test.ts` (if it doesn't exist; check first) — add the two new tests below.

**Step-by-step:**

1. **Write the failing test** in `voiceCatalog.test.ts`:

   ```ts
   import { describe, expect, it } from "vitest";
   import {
     createElevenLabsCatalog,
     ElevenLabsVoiceCatalog,
   } from "../voiceCatalog";

   describe("createElevenLabsCatalog", () => {
     it("returns an ElevenLabsVoiceCatalog instance", () => {
       const catalog = createElevenLabsCatalog("test-api-key");
       expect(catalog).toBeInstanceOf(ElevenLabsVoiceCatalog);
     });

     it("throws when apiKey is empty", () => {
       expect(() => createElevenLabsCatalog("")).toThrow(/apiKey/i);
     });
   });
   ```

2. `bun run --filter @alien-lobster-buffet/tts-conductor-provider-elevenlabs test` — expect both tests fail (import not exported yet).
3. **Implement the factory** in `voiceCatalog.ts`:
   ```ts
   export function createElevenLabsCatalog(
     apiKey: string,
   ): ElevenLabsVoiceCatalog {
     if (!apiKey) {
       throw new Error("createElevenLabsCatalog requires a non-empty apiKey");
     }
     return new ElevenLabsVoiceCatalog(new ElevenLabsClient({ apiKey }));
   }
   ```
   (Add the missing import of `ElevenLabsClient` from `@elevenlabs/elevenlabs-js` — it's not currently imported in this file; `ElevenLabsClient` is referenced only as a type via `ElevenLabsClient` in the constructor parameter. Add a value import.)
4. **Export from `index.ts`** — add `createElevenLabsCatalog` to the named exports.
5. `bun run --filter @alien-lobster-buffet/tts-conductor-provider-elevenlabs test` — expect both new tests pass.
6. `bun run check` — full monorepo gate.
7. Commit: `feat(11labs): add createElevenLabsCatalog(apiKey) factory`.

### Phase 4 — README updates

**Goal.** Two documentation additions in the core README. No code change.

**Files to modify:**

- `packages/tts-core/README.md` — add a "BullMQ heartbeat" subsection under whatever existing section covers `onProgress` (or under a new "Worker integration" subsection if none exists). Add a "Multi-tenant / untrusted input" subsection (or update the existing one) covering `maxPauseSeconds`.

**Content to add:**

_BullMQ heartbeat snippet:_

````md
### BullMQ Heartbeat Pattern

When running synthesis inside a BullMQ worker, wire `onProgress` to `job.updateProgress` so long-running jobs heartbeat continuously and don't trip BullMQ's stall detection:

```ts
await conductor.buildAudio(script, {
  onProgress: (percent) => job.updateProgress(percent),
});
```
````

Without this, jobs synthesizing many chunks may exceed BullMQ's default stall timeout and get retried mid-synthesis — wasting API credits and producing duplicate audio.

````

*`maxPauseSeconds` callout:*
```md
### Untrusted Input Safety

If your scripts are user-authored or otherwise untrusted, set `maxPauseSeconds` on your `TtsRuntimeConfig` to a sane bound:

```ts
const conductor = createTtsConductor({
  pauseTable: DEFAULT_PAUSE_TABLE,
  maxPauseSeconds: 30,  // clamp any [PAUSE:Xs] longer than this
});
````

The default is unbounded — appropriate for trusted inputs (e.g., guided meditation with long contemplative silences) but unsafe for multi-tenant orchestrators. Without this clamp, a script like `[PAUSE:99999s]` would generate roughly 27 hours of silence per chunk.

```

**Step-by-step:**

1. Apply README edits.
2. Read the modified README in full to confirm formatting/flow is coherent (no orphan section headers, no broken markdown).
3. Commit: `docs(core): add BullMQ heartbeat + maxPauseSeconds untrusted-input callouts`.

### Phase 5 — Version, CHANGELOG, manifest, peerDep

**Goal.** Stage the release. No publish yet in this phase.

**Files to modify:**

- `packages/tts-core/package.json` — bump `version` to `0.2.0-alpha.0`.
- `packages/tts-provider-elevenlabs/package.json` — bump `version` to `0.2.0-alpha.0`; bump the `peerDependencies["@alien-lobster-buffet/tts-conductor-core"]` constraint from `^0.1.0-alpha.0` to `^0.2.0-alpha.0`.
- `packages/tts-core/CHANGELOG.md` — add a `## 0.2.0-alpha.0 — 2026-05-24` section with a `### Breaking Changes` subsection (the rename) and a `### Added` subsection (BullMQ heartbeat doc, maxPauseSeconds callout).
- `packages/tts-provider-elevenlabs/CHANGELOG.md` — add a `## 0.2.0-alpha.0 — 2026-05-24` section. `### Breaking Changes`: bump peerDep on core (transitive rename impact). `### Added`: `createElevenLabsCatalog(apiKey)` factory.
- `.release-please-manifest.json` — update both package entries from `0.1.0-alpha.0` to `0.2.0-alpha.0`.

**Step-by-step:**

1. Apply version bumps + manifest sync + CHANGELOG entries.
2. `bun install` from repo root — refreshes the lockfile against the new peerDep constraint. Expect no test or build impact (workspace resolution).
3. `bun run check` — final gate.
4. `bun run --filter '*' build` — verify both packages build cleanly with the new versions.
5. Commit: `chore: bump packages to 0.2.0-alpha.0 + changelogs + manifest`.

### Phase 6 — Publish + bridge release notes

**Goal.** Publish both packages to npm and post release notes back to the bridge thread so MF and Story Loom can do their one-line updates.

**Pre-publish.** Confirm with Cole that:
- `npm whoami` returns the correct account.
- A `git status` shows the branch is clean.
- The branch has been reviewed (per the proposal's "Reviewer: Socrates" gate).

**Step-by-step:**

1. From repo root: `cd packages/tts-core && npm publish --tag alpha` — publish core first (elevenlabs has peerDep on it). Verify the `+ @alien-lobster-buffet/tts-conductor-core@0.2.0-alpha.0` line in the output.
2. `cd ../tts-provider-elevenlabs && npm publish --tag alpha` — publish elevenlabs.
3. `npm cache clean --force` — required per Hivemind playbook (`Publishing a Bun workspace to npm (first prerelease)`). The npm CLI caches 404s aggressively and will show stale "not found" results otherwise.
4. Verify: `npm view @alien-lobster-buffet/tts-conductor-core@0.2.0-alpha.0` and `npm view @alien-lobster-buffet/tts-conductor-provider-elevenlabs@0.2.0-alpha.0`. Both should return manifests.
5. Post release notes to the bridge thread (`e96ee646-b14c-4bb2-9ce8-9c9238aa73a8`) via `reply_to_thread`. Content template:

```

`0.2.0-alpha.0` published. Both packages live on npm under the `@alpha` tag.

**Install (consumers):** `bun add @alien-lobster-buffet/tts-conductor-core@alpha @alien-lobster-buffet/tts-conductor-provider-elevenlabs@alpha`

**Migration:** rename `pauses` → `pauseTable` at every call site (construction-time and per-call). One-line diff per consumer, as previously confirmed.

**Bundled:** `createElevenLabsCatalog(apiKey)` factory in `-elevenlabs`; README updates in `-core` (BullMQ heartbeat pattern, `maxPauseSeconds` untrusted-input callout).

Cherry / Batman — ping when your one-line update lands.

```
6. Commit: `chore: publish 0.2.0-alpha.0` (or skip if there are no in-repo changes from the publish — `npm publish` doesn't modify the working tree).

### Phase 7 — Finalize branch (after Socrates review)

The implementer should hand off to Cole at the end of Phase 6 for Socrates' final review. Once the review is signed off, follow the `/project-docs:finalize-branch` workflow:

- Independent code review (Socrates does this; the implementer should not self-review).
- `bun run check` final gate.
- Session doc in `./sessions/2026-05-DD-pause-table-rename-and-catalog-factory-session.md` (use today's date when implementing).
- Squash to a single coherent commit (small enough work that Strategy A — single-commit squash — is right; do not use the consolidate-long-branch skill for this).
- Merge to `develop` (fast-forward only), then to `main` when the release-please PR catches up.

## Key Risks & Mitigations

- **Risk: rename misses a usage site.** Mitigation: the verify steps in Phases 1 and 2 (`grep -rn "pauses" packages/{tts-core,tts-provider-elevenlabs}/src`) explicitly check for residual field-access usages. The CI gate (`bun run check`) will catch any type-level miss; runtime tests will catch any string-key access that bypasses the type system (none expected).
- **Risk: `createElevenLabsCatalog` factory breaks existing consumers who construct `ElevenLabsVoiceCatalog` directly.** Mitigation: the factory is purely additive; `ElevenLabsVoiceCatalog` stays exported and constructable.
- **Risk: npm publish cache-404 gotcha breaks post-publish verification.** Mitigation: documented in step 3 of Phase 6; the `npm cache clean --force` step is explicit, not optional.
- **Risk: peerDep range bump introduces version-conflict warnings in consumer projects with pinned alpha.0 versions.** Mitigation: the rename forces the peerDep bump regardless; consumer migration message explicitly tells them to update both packages.
- **Risk: README markdown formatting subtly breaks rendering on npmjs.com.** Mitigation: spot-check rendering on npmjs.com after publish; the snippets use standard fenced code blocks that have been verified to render in the existing alpha.0 README.

## Testing Strategy

- **Type-level**: `bun run check-types` catches every rename miss as a compile error. The existing `typed-integration.test.ts` style tests serve as the compile-time pinning of the new field name.
- **Behavior-level**: existing tests in `operations.test.ts:350-367` already cover the per-call override semantics that aren't changing. After Phase 1/2, those tests should pass under the renamed field and continue to assert the same invariants.
- **New tests**: only the two `createElevenLabsCatalog` tests in Phase 3.
- **Manual smoke**: not required. The rename has no behavioral change, and the factory is structurally trivial. The full unit-test suite + typecheck + lint gate is sufficient.

## Assumptions & Constraints

- **npm publish credentials.** Cole has the npm account and runs publish manually (per the Hivemind playbook). No CI publish path yet.
- **Both alpha.0 consumers have acked** the rename via the bridge thread. No further coordination required before publish; the post-publish bridge message is informational.
- **No `dist/` rebuild step in commits.** The `tsdown` build runs at publish time via the `prepublishOnly` script (verify this exists in each package's `package.json`; if absent, run `bun run --filter '*' build` manually before `npm publish` in Phase 6).
- **Working from `develop`.** Branch off develop, merge back to develop, let the release-please PR cycle promote to main.

## Open Questions

1. **Catalog factory signature surface.** `createElevenLabsCatalog(apiKey: string)` is the minimum useful surface. Should it also accept the optional `ElevenLabsClient` config (`baseUrl`, custom `fetch`, etc.) that the SDK supports? **Recommend: start with `apiKey` only.** Expose `(opts: ElevenLabsClientOptions)` overload only when a consumer asks. Premature flexibility costs API surface. If the implementer hits a reason to broaden the signature mid-implementation (e.g., a test needs to inject a custom client), stop and surface to Socrates rather than expanding the public surface unilaterally.

2. **`maxPauseSeconds` README placement.** The proposal calls for "an untrusted-input section, creating that section if it doesn't yet exist." The implementer should make the call on whether to thread it into an existing section or create a fresh one — bias toward fitting into existing structure if a "Configuration" or "Multi-tenant" section already exists.

3. **CHANGELOG date format.** Hard-code `2026-05-24` per today's date, or let release-please rewrite the heading? **Recommend: hard-code the date** for the manual publish; release-please's manifest sync (Phase 5 step 3) handles the version, but the CHANGELOG entry under that version is hand-written for this release.

---

## Implementer briefing (what to read before starting)

- Read this plan in full.
- Read the source proposal at `./proposal.md`.
- Read the bridge thread context indirectly: the proposal references thread `e96ee646-b14c-4bb2-9ce8-9c9238aa73a8` for consumer coordination, and knowledge entry `0578b83c-796f-4eb5-8293-fdfd4636d8a9` (Socrates' triage) for the upstream reasoning. The implementer doesn't need bridge access to do the work, but the proposal pulls forward the key decisions.
- Read the Hivemind playbook on npm publish for Bun workspaces — Cole has the link; reference the cache-404 step explicitly.
- Read the existing `tts-conductor-migration` session docs under `docs/projects/_archive/alpha-0-publish-prep/sessions/2026-05-23-*.md` if context on the existing per-call-override implementation would help — particularly `2026-05-23-per-call-overrides-session.md`.
- Don't start implementation until the proposal *and* this plan have been read end-to-end.
```
