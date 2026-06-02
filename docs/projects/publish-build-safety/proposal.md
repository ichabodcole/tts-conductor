# Publish Build Safety — `prepublishOnly` + gitignored `dist/`

**Status:** 📝 Draft (2026-05-24)
**Target release:** None — these changes activate on the next real-content release. No standalone publish needed.
**Includes breaking change:** No (build-time only; no runtime behavior change, no API change).

## Context

The `0.2.0-alpha.0` → `0.2.0-alpha.1` hotfix cycle (session: `docs/projects/multi-tenant-pauses-and-catalog/sessions/2026-05-24-pause-table-rename-and-catalog-factory-session.md`) traced to a single root cause: the implementer ran `bun run build` to refresh `dist/` in one commit, then added a new export (`createElevenLabsCatalog`) in a later commit, then ran `npm publish` against the still-committed-but-stale `dist/`. The source declared the export; the compiled artifact did not. Cherry's `TS2305` was the consequence.

Two compounding properties of the current setup enabled the failure:

1. **`dist/` is committed to the repo.** This means `dist/` and `src/` are two independently-tracked copies of the same logical thing — and they can drift between commits without any signal.
2. **`npm publish` trusts whatever's on disk.** No automatic rebuild before publishing. The implementer or publisher has to remember to rebuild after every source change. Easy to forget when commits are small and the rebuild is "obviously" needed but mechanically separate.

The two changes in this proposal eliminate both compounding properties, closing the entire class of "stale dist published" failures regardless of implementer discipline.

This is a **follow-up to the alpha.1 hotfix**, not its replacement. The hotfix shipped the actual fix; this proposal hardens the publish path so the failure mode can't recur.

## Goals

- Make it structurally impossible to publish a `dist/` that doesn't match the source it claims to compile from.
- Remove `dist/` diff noise from PRs (no more "refresh dist" commits, no more reviewing line-by-line dist diffs that are just compilation artifacts).
- Move closer to a CI-based publish workflow without committing to one yet — these changes work with manual publish today and continue to work after release-please wiring lands.

## Proposed Changes

### 1. Add `prepublishOnly: "tsdown"` to each package's `scripts` block

**Files to modify:**

- `packages/tts-core/package.json` — add `"prepublishOnly": "tsdown"` to the `scripts` block.
- `packages/tts-provider-elevenlabs/package.json` — same.

**Why `prepublishOnly` rather than `prepare`.** Both are npm lifecycle hooks; the difference:

- `prepare` runs on `npm install` (and `npm publish`) — useful when consumers install directly from a git URL because it forces a build at install time.
- `prepublishOnly` runs only on `npm publish` — cleaner when consumers always install from the npm registry.

Since the packages publish to npm and consumers always install from the registry (not from git), `prepublishOnly` is the right hook. It forces a fresh build immediately before `npm publish` packages the tarball, every publish, every machine, with zero implementer discipline required.

**Why `tsdown` directly rather than `bun run build`.** npm runs lifecycle scripts in the package's own directory with the package's `package.json` scripts available. Using `tsdown` directly (the same command the existing `build` script runs) avoids any indirection. It's also faster — no need to spin up `bun run` overhead for a one-line script.

### 2. Gitignore `dist/` and untrack the existing committed copies

**Files to modify:**

- Root `.gitignore` — add `packages/*/dist/`. (Or add `dist/` per-package via per-package `.gitignore` files; either works. Single-line root entry is simpler.)
- `packages/tts-core/dist/` — `git rm -r --cached` to untrack without deleting working-tree files.
- `packages/tts-provider-elevenlabs/dist/` — same.

After the change: `dist/` directories continue to exist locally (the `prepublishOnly` script will keep regenerating them; developers running `bun run build` directly still produce them locally). They just stop being tracked in git, which means:

- No more committed dist artifacts.
- No more dist diffs in PRs.
- Consumers installing the published package are unaffected — npm bundles `dist/` into the published tarball based on the `files` field in `package.json` (`"files": ["dist", "LICENSE", "README.md"]`), which is unchanged by this proposal.

## Out of Scope

- **Wiring up release-please's publish workflow.** That's the bigger automation move and deserves its own proposal. This change is the cheap precursor that makes the eventual automation safer (every CI publish workflow should do `bun run build` before `npm publish` regardless of these changes; adding `prepublishOnly` is a second line of defense).
- **npm provenance attestation.** Belongs with the CI publish work.
- **Changing the `dist/` build target or output format.** No build config changes; this proposal only adjusts when the build runs and whether its output is tracked.

## Impact and Dependencies

**Backward compatibility.** Fully compatible at every consumer-facing surface:

- Published artifacts unchanged. The next publish (whenever that is) will produce a fresh `dist/` identical in shape to what we'd produce today, just freshly compiled.
- npm package shape unchanged (`main`, `types`, `exports`, `files` all unchanged).
- No version bump needed.

**Local development.** Three subtle implications worth verifying before merging:

1. **Workspace internal references.** `-elevenlabs` has `devDependencies: { "@alien-lobster-buffet/tts-conductor-core": "workspace:^" }` which resolves to the local `packages/tts-core` directory in Bun workspaces. The `main` of `-core` is `./dist/index.mjs`. After gitignoring, a fresh `bun install` won't produce `dist/` — only `bun run build` will. **Verification step:** confirm that the existing turbo task ordering (`bun run check`'s pipeline) runs `build` before `test` / `typecheck`, so `dist/` exists by the time any internal import resolves to it. If not, add a `prepare` script as well, or document the explicit "run build first" requirement.

2. **First-time-clone friction.** A new contributor cloning the repo and running `bun run test` from a `-elevenlabs` package directory directly (bypassing turbo) would hit "missing `dist/`" errors. The right fix is to ensure all developer workflows go through turbo (which builds upstream packages first), or to document the explicit-build step. Mostly hypothetical concern given how this project is actually used.

3. **`dist/` diff hygiene.** Existing tracked `dist/` files need a `git rm -r --cached` to untrack them — without that, gitignoring an already-tracked path has no effect. The untrack commit will show as a large deletion of committed artifacts, which is expected and one-time.

**Release-please interaction.** When release-please's publish workflow eventually lands, it should still do `bun run build` before `npm publish` as belt-and-suspenders. The `prepublishOnly` hook is the second line of defense; the CI build step is the first.

## Decisions Made

1. **`prepublishOnly` not `prepare`.** Documented above. Packages publish to npm only; no git-install consumers.

2. **`tsdown` not `bun run build`.** Direct call avoids `bun run` indirection. Both invoke the same compiler.

3. **No version bump.** These are build-system changes with no runtime effect. Adopting them on the next real-content release (not as a standalone publish) avoids npm version-noise that adds no consumer value.

4. **Gitignore at the root, not per-package.** `packages/*/dist/` in the root `.gitignore` is one line and covers both packages. Per-package `.gitignore` files would also work but add files.

## Open Questions

1. **Turbo task ordering.** The Impact section flags this as a verification step. The implementer should confirm `bun run check`'s task graph runs `build` before `test` / `typecheck` / `lint` against the affected package's `dist/`. If the ordering isn't already correct, fixing it is a one-line `turbo.json` change (add `dependsOn: ["^build"]` to the relevant tasks).

2. **Should we add a `prepare` script as belt-and-suspenders for fresh-clone scenarios?** Pros: covers the "developer cloned the repo and ran a single-package command directly without turbo" case. Cons: runs the build on every `bun install`, which is most of them, adding latency. Lean: skip for now; if the friction surfaces in practice we add it. The right primary fix is "everyone uses turbo." Surface to Cole if implementation makes this question concrete.

3. **Should this proposal also remove the `build` script in favor of always using `prepublishOnly`?** No — `build` is the developer-facing command for explicit builds (e.g., when verifying changes locally). Two scripts pointing at the same compiler is fine; they serve different audiences.

## Related Documents

- Session doc: `docs/projects/multi-tenant-pauses-and-catalog/sessions/2026-05-24-pause-table-rename-and-catalog-factory-session.md` — the alpha.1 hotfix retro that surfaced this failure mode.
- Bridge thread: `e96ee646-b14c-4bb2-9ce8-9c9238aa73a8` — coordination thread where the bug landed (`msg 4820a913` is Cherry's repro; `msg 191afac5` is the fix announcement).
- `docs/projects/multi-tenant-pauses-and-catalog/proposal.md` — the alpha.0.2 release proposal whose hotfix motivated this work.
