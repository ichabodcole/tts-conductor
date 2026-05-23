# 2026-05-23 — First npm publish (alpha)

## Goals

Close Task #5: ship the first public npm publish for both packages. Per Cole's
decision, this would be a `0.1.0-alpha.0` prerelease that consumers must opt
into via `@alpha`, so they can test the API and surface integration bugs before
we commit to a 1.0 shape.

## Versioning + scope decisions (locked in via AskUserQuestion)

- **Shape**: `0.1.0-alpha.0`. Pre-1.0 (semver-flexible) AND explicit `alpha`
  prerelease tag. Forces opt-in install. Keeps the door wide open for breaking
  changes based on consumer feedback.
- **Scope**: `@alien-lobster-buffet` — a personal npm org Cole already owns and
  is the listed owner of. Original `@tts-conductor` scope was never claimed and
  would have required an org-creation step we didn't want to gate on.
- **Publish path**: manual first publish from local; release-please / GH Action
  automation deferred. Cole wanted to see every step of the first publish flow
  rather than have it happen invisibly in CI.

## Rename work

Renamed across all live code, config, and consumer-facing docs:

- `@tts-conductor/core` → `@alien-lobster-buffet/tts-conductor-core`
- `@tts-conductor/provider-elevenlabs` →
  `@alien-lobster-buffet/tts-conductor-elevenlabs`

Files updated:

- Both `package.json` files (name, peer/devDeps cross-reference)
- All source imports in the provider package (factory.ts in core, plus
  elevenLabsProvider.ts, voiceCatalog.ts, tsdown.config.ts, and every test file
  in provider-elevenlabs)
- READMEs (root + both packages)
- AGENTS.md, PROJECT-SUMMARY.md, PROJECT_MANIFESTO.md (current-state docs)
- release-please-config.json + .release-please-manifest.json

Historical docs (sessions/, reports/, proposals/, prior CHANGELOG entries) were
deliberately left untouched — those are point-in-time records and rewriting them
would falsify history. The two CHANGELOG.md files were reset to bare `# Changelog`
headers because their prior 1.0/1.1 entries were from internal release-please
runs that never made it to npm and referenced soon-to-be-deleted git tags.

## Version drop

`1.1.0` → `0.1.0-alpha.0` in both package.json files and in the release-please
manifest.

## npm-publish metadata added

For both packages:

```json
{
  "author": "Cole Reed <alienlobsterbuffet.dev@gmail.com>",
  "homepage": "https://github.com/ichabodcole/tts-conductor#readme",
  "bugs": { "url": "https://github.com/ichabodcole/tts-conductor/issues" },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/ichabodcole/tts-conductor.git",
    "directory": "packages/<dir>"
  },
  "engines": { "node": ">=18" },
  "publishConfig": { "access": "public" }
}
```

The `publishConfig.access: "public"` is the one consumers and the npm CLI must
see — scoped packages default to `restricted` (private), and the publish fails
with a billing error without explicit opt-in to public.

The `repository.directory` field is the standard monorepo pointer — npm uses it
to link the right source subdirectory from the package page on npmjs.com.

## Peer-dependency shape

Elevenlabs adapter's peer dep on core was `workspace:*`. The Bun/pnpm
`workspace:` protocol isn't understood by raw npm at install time — `npm publish`
would have published the literal string `workspace:*` into the tarball,
breaking any consumer who installed via npm. Converted to `^0.1.0-alpha.0` so
the published tarball carries a real semver constraint. devDeps kept
`workspace:^` because devDeps don't get included in the published tarball.

## Pre-publish GitHub cleanup

Deleted four orphan tags + GitHub releases from the September 2025 internal
release-please runs:

- `core-v1.0.0`, `provider-elevenlabs-v1.0.0`
- `@tts-conductor/core-v1.1.0`, `@tts-conductor/provider-elevenlabs-v1.1.0`

These never made it to npm and referenced package names that were about to be
obsolete. Cleaning them up means the GitHub Releases page tells a clean story
starting from the upcoming `0.1.0-alpha.0` releases (whichever workflow we wire
up to drive those — see Follow-ups).

## Publish verification (the bit that matters)

`npm pack --dry-run` from each package directory confirmed clean tarball
contents:

- core: 45kB packed, 6 files (LICENSE, README, dist/index.{mjs,d.mts,mjs.map},
  package.json)
- elevenlabs: 14kB packed, same shape

`npm publish --tag alpha` from each package dir (in publish order — core first,
then elevenlabs, because elevenlabs has a peerDep on core that should exist in
the registry by the time elevenlabs lands):

- Both succeeded with the `+ @alien-lobster-buffet/...@0.1.0-alpha.0` line
- Core required a one-time browser auth (npm CLI's web-auth flow opened a URL,
  Cole completed it); elevenlabs used the cached auth and didn't re-prompt

Verified post-publish:

- Both package pages render publicly on npmjs.com (confirmed via incognito browser)
- `npm access get status` returns `public` for both
- Authenticated org-package listing
  (`/-/org/alien-lobster-buffet/package`) shows both with write access
- `npm install @alien-lobster-buffet/tts-conductor-core@alpha` resolves and
  installs cleanly into a scratch dir (after `npm cache clean --force` — see
  Gotcha below)

## Gotchas surfaced

### Pre-publish `npm view` 404 cache

Before publishing, I ran `npm view @alien-lobster-buffet/...` from the script —
which returned 404 (expected, the package didn't exist yet). After publishing,
the same command STILL returned 404, even though the package page worked in
incognito and `npm install` would later succeed.

Root cause: npm CLI caches negative responses (404s) for a while. The
post-publish 404 was the cached pre-publish miss, not a real registry miss.
`npm cache clean --force` fixed it.

This is worth knowing for future publishes: if you ever run `npm view` against
a package that doesn't exist yet, expect the cached miss to confuse you after
the publish completes.

### `npm publish` doesn't work from inside a workspace child package

The root `package.json` has `workspaces: ["packages/*"]`. npm refuses to run
non-workspace commands from inside a workspace child — `npm config get registry`
errored with `ENOWORKSPACES` when run from `packages/tts-core/`. Cole's
`npm publish` from inside the package dir DID succeed though; the workspaces
handling for publish specifically is different from `npm config`.

If we ever switch to running `npm publish` from CI or from the repo root, the
form is `npm publish -w @alien-lobster-buffet/tts-conductor-core --tag alpha`.

### First-publish `latest` tag

npm's first-publish behavior for a brand-new package name is to set BOTH the
specified `--tag` AND `latest` to the published version, regardless of intent.
So `npm view ... dist-tags` shows
`{ alpha: '0.1.0-alpha.0', latest: '0.1.0-alpha.0' }`.

Decision: leave it as-is. The asymmetry only matters once a stable version
exists. When we publish `0.1.0` stable later (no `--tag` flag), `latest` will
move to the stable release and the alpha lifecycle works correctly from that
point onward. In the meantime, `npm install ...` (no tag) and
`npm install ...@alpha` both resolve to the same version — there's nothing
harmful about that when only one version exists.

## Outcomes

Both packages are live on npm:

- https://www.npmjs.com/package/@alien-lobster-buffet/tts-conductor-core
- https://www.npmjs.com/package/@alien-lobster-buffet/tts-conductor-elevenlabs

Cole can now share the `@alpha` install instructions with consumers to gather
feedback before committing to 1.0.

Task #5 closed.

## Files Modified

- Both `packages/*/package.json` (name, version, peer/devDeps, full
  publish-metadata block)
- All source imports in `packages/tts-provider-elevenlabs/src/` and the
  provider package's tests, plus the core package's `factory.ts` JSDoc example
- `packages/tts-provider-elevenlabs/tsdown.config.ts` (the external array)
- `README.md`, `AGENTS.md`, `packages/tts-core/README.md`,
  `packages/tts-provider-elevenlabs/README.md`
- `docs/PROJECT-SUMMARY.md`, `docs/PROJECT_MANIFESTO.md`
- `release-please-config.json`, `.release-please-manifest.json`
- `packages/tts-core/CHANGELOG.md`, `packages/tts-provider-elevenlabs/CHANGELOG.md`
  (reset to bare header)
- `bun.lock` (resolution refresh under new names)
- `packages/tts-core/dist/index.d.mts` (rebuilt — type declarations re-emitted
  with the new package name in module-augmentation contexts)

## Follow-ups

- **release-please automation.** The workflow at `.github/workflows/release-please.yml`
  runs on push to `main` and creates release PRs — but it has no `npm publish`
  step. The first time we merge to main with the renamed packages, release-please
  will likely propose a release PR for `0.2.0-alpha.0` (because of all the
  conventional-commit history sitting in develop). We should either close that
  PR until ready, or extend the workflow to call `npm publish` once we're
  confident the alpha process is settled.
- **`NPM_TOKEN` for CI publish.** When we wire `npm publish` into the workflow,
  it needs an `NPM_TOKEN` GitHub secret. Provenance attestation (npm signing
  publishes with the GitHub repo identity) is a nice trust signal worth adding
  at the same time.
- **First stable release strategy.** When the alpha feedback settles, we cut
  `0.1.0` (no `--tag` flag, so `latest` moves to it). Future alphas land under
  `@alpha` without disturbing `latest`. Document the publish playbook in
  `docs/` once the GH Action covers it.
- **Deferred-items Bucket 2.** Items D5 (HTTP-date Retry-After test coverage),
  D6 (`signal.throwIfAborted()` between execa calls in `getAudioDuration`),
  D7 (`mockReset` defensive refactor), D8c (ElevenLabs adapter known limitations
  doc) are all post-publish — address opportunistically based on consumer
  feedback or natural next-touch.
