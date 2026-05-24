# Dev Kickoff — `pauseTable` Rename + Catalog Factory (`0.2.0-alpha.0`)

**Created:** 2026-05-24
**Author:** Socrates (strategist, TTS Conductor)
**Implementer:** TBD (fresh engineering session)
**Reviewer:** Socrates (final review before publish)
**Branch:** create `feature/alpha-0.2-pause-table-rename` from `develop` (no worktree needed — single-developer flow)

## Mission

Ship `0.2.0-alpha.0` of `@alien-lobster-buffet/tts-conductor-core` and `@alien-lobster-buffet/tts-conductor-provider-elevenlabs` to npm under the `@alpha` tag.

Three substantive changes, one release. All scope is fully specified in the proposal and plan referenced below — do not invent additional scope.

## Read these in order before touching code

1. **Plan** — `./plan.md`. This is your turn-by-turn for the work. Read it end-to-end before starting Phase 1.
2. **Proposal** — `./proposal.md`. The "why" and the decisions already made. Read for context; the plan is the actionable document.
3. **PROJECT-SUMMARY.md** and **PROJECT_MANIFESTO.md** at `docs/` root — fast orientation if this is a fresh-context session.

## What's already settled (don't relitigate)

These decisions are locked. If you find yourself questioning them mid-implementation, surface to Socrates before acting — don't unilaterally revisit:

- **Field name is `pauseTable`** (not `pauses`, `pauseMap`, or `pauseOverrides`). Rationale lives in the proposal's "Decisions Made" §1. Both bridge consumers (Cherry / Story Loom, Batman / Media Forge) have acked the rename on bridge thread `e96ee646-b14c-4bb2-9ce8-9c9238aa73a8`.
- **Override semantics: full replace** (per-call `pauseTable` shadows construction-time `pauseTable` entirely; no shallow merge). This is _already_ the shipped behavior in alpha.0 — this release pins it.
- **Version target: `0.2.0-alpha.0`** for both packages (minor bump telegraphs the breaking rename under SemVer-for-alphas conventions).
- **Catalog factory minimum surface: `createElevenLabsCatalog(apiKey: string)`**. If a test or mid-implementation discovery suggests broadening to accept an `ElevenLabsClientOptions` object, **stop and surface to Socrates** — don't expand the public API unilaterally.

## What's NOT in scope (despite being on the broader backlog)

If you find yourself drifting toward any of these, stop and re-read the proposal's "Out of Scope" section. None of these ride along in this release:

- Audio primitives extraction (`mp3ToWav` / `concatenateAudio` exposed for non-synthesis consumers).
- `usage` field on `GenerationResult`.
- Bucket C polish: `base64Data` getter, `tier` semantics, ffprobe / parser-regex / debug-sink doc notes.
- Any other items from `docs/backlog/deferred-items.md`.

## Hard gates before publish

In order. Do not skip:

1. `bun run check` clean (typecheck + lint + tests, full monorepo).
2. `grep -rn "pauses" packages/{tts-core,tts-provider-elevenlabs}/src` returns only English-prose comment usages, not field-access usages.
3. `bun run --filter '*' build` produces clean `dist/` in both packages.
4. **Socrates review.** Hand off the branch to Cole; Cole will dispatch Socrates for independent code review (per the proposal's reviewer assignment). Do not self-review and do not publish until that review is signed off.
5. Only then: `npm publish --tag alpha` from each package directory (core first, then `-elevenlabs`).

## If something surprises you

The strategist (Socrates) has already done a verification pass and found one material scope-shift mid-stream (the per-call override was already shipped — see proposal §1's "Pre-existing state" callout). If your own pre-implementation scan turns up _another_ surprise — something in the code that contradicts the plan's stated state — **stop and surface it** before continuing. Don't quietly adapt; the plan is wrong if your scan disagrees, and a quiet adaptation hides the mismatch from future readers.

Specifically, surface upward if:

- A rename target the plan names doesn't exist in the location stated.
- An existing test's behavior contradicts a "behavior unchanged" claim in the plan.
- The `createElevenLabsCatalog` design conflicts with an existing export pattern in `-elevenlabs/index.ts` you weren't told about.
- `npm publish` fails for any reason — do not retry blindly; read the Hivemind "Publishing a Bun workspace to npm (first prerelease)" playbook for known failure modes, and surface anything not covered there.

## After publish

Phase 6 step 5 in the plan has the template for the bridge release-notes message. **Do not post it yourself** — the bridge is a coordination surface under Cole's identity. Pass the drafted message back to Cole for posting. He'll relay it to the bridge thread.

Phase 7 is the `/project-docs:finalize-branch` workflow. Single-commit squash (Strategy A), session doc in `./sessions/2026-05-DD-pause-table-rename-and-catalog-factory-session.md` (use the actual publish date), then merge to `develop`. `main` catches up via the release-please cycle.

## One-line summary for context cards

> Renaming `pauses` → `pauseTable` everywhere (breaking, alpha-window only), adding `createElevenLabsCatalog(apiKey)` factory, two README callouts, publishing as `0.2.0-alpha.0`. Both alpha consumers have acked. Plan: `./plan.md`.
