# Project Summary

**Last Updated:** 2026-05-22
**Project Status:** Paused (last commit 2025-11-20, ~6 months dormant)

## Overview

`tts-conductor` is a small TypeScript monorepo that provides reusable building blocks for text-to-speech orchestration. The core package handles the parts of TTS that don't depend on a specific vendor — parsing scripts with inline pause markers into segments, chunking those segments to fit provider character and break-length limits, invoking a registered provider once per chunk, and stitching the resulting audio buffers into a final track with ffmpeg.

The defining design decision is a provider-pluggable contract: `@alien-lobster-buffet/tts-conductor-core` knows nothing about specific TTS vendors, and concrete adapters implement a small `TtsProvider` interface. The first (and currently only) adapter is `@alien-lobster-buffet/tts-conductor-elevenlabs`, which wraps the official ElevenLabs JS SDK.

The repo has been quiet since November 2025 — the architecture and one adapter are in place, but no further providers or feature work have landed since.

## Core Technologies

- **Primary Language:** TypeScript 5.9 (ESM, `type: module`)
- **Workspace:** pnpm 8.15.5 + Turborepo 2.6
- **Build Tools:** tsdown 0.16.6 (recently migrated from tsup), release-please for version automation
- **Key Dependencies:** `@elevenlabs/elevenlabs-js` (provider), `execa` + `ffmpeg-static` (core audio stitching/probing)
- **Development Tools:** Vitest 3.2 (`@vitest/coverage-v8`), ESLint 9 flat config + `eslint-config-turbo`, Prettier 3.6, Husky 9
- **Runtime:** Node ≥18.18, requires `ffmpeg`/`ffprobe` available, `ELEVENLABS_API_KEY` env var

## Project Structure

```
packages/
  tts-core/                  # parsing, chunking, ffmpeg stitching, provider registry
    src/
      conductor.ts           # provider registry + createProvider
      factory.ts             # TtsProviderContext, factory contract
      provider.ts            # TtsProvider interface, GenerationResult
      operations.ts          # ttsGenerateFull: parse → chunk → generate → stitch
      config.ts, defaults.ts # runtime config
      utils/                 # segmenter, chunker, duration, stitcher, pause, debug
      __tests__/             # 9 Vitest suites
  tts-provider-elevenlabs/   # ElevenLabs SDK bridge implementing TtsProvider
    src/
      elevenLabsProvider.ts
      __tests__/             # 3 Vitest suites
docs/
  proposals/                 # design proposals (1: tts-interface-alignment ✅)
  sessions/                  # work-session logs (1: 2025-09-29)
  lessons-learned.md         # template only — no entries yet
  reports/                   # discovery reports
```

The codebase is small (~450 LoC of source across both packages) and organized by responsibility, not by feature.

## Documented Systems

No `docs/architecture/` directory exists. Architectural intent is captured implicitly across `AGENTS.md`, the proposal, and the session note.

- **TTS core ↔ provider contract** — Documented in `docs/proposals/tts-interface-alignment.md` (completed 2025-09-29). Establishes that `TtsProvider` exposes a `readonly id: string` (flowed through `TtsProviderContext` at construction time) and a `generate(chunk)` returning `GenerationResult { audio, mimeType?, duration?, size? }` with optional metadata fields. When a provider supplies `duration`, the core trusts it and skips a redundant ffprobe call.

## Application Specifications

No application specifications have been created yet. `docs/specifications/` does not exist.

## Recent Activity (Last 30 Days)

**Zero commits in the last 30 days.** The repository has been dormant since 2025-11-20.

The most recent burst of work (Sept–Nov 2025) focused on build-tooling and interface polish, not features:

- `66870b4` — tsup → tsdown migration
- `8335b71` — processing-stage / debug typing refactor
- `0688a78` — Turbo v2 upgrade, ESLint config updates
- `cd65f33` — core↔provider interface alignment (the proposal above, fully implemented)
- Earlier: release-please + Husky automation, initial implementation of core + ElevenLabs provider

**Recent Sessions:**

- 2025-09-29 — Interface review and implementation (see `docs/sessions/2025-09-29-interface-review-session.md`). Drove the core↔provider contract refactor: added provider `id` propagation through context, made `GenerationResult` metadata optional, eliminated duplicate ffprobe duration calls.

## Current Direction

**Active Projects:** None. There is no `docs/projects/` directory and the only proposal is marked completed.

**In Progress Investigations:** None. There is no `docs/investigations/` directory.

Based on commit trajectory before dormancy, the project was sharpening the core↔provider seam to make additional adapters cheap to add — but that second adapter has not materialized. The repo is in a "shippable but paused" state.

## Development Patterns & Practices

- **Sessions log:** `docs/sessions/` with `YYYY-MM-DD-short-topic.md` naming, per `AGENTS.md`. One entry exists.
- **Lessons learned:** `docs/lessons-learned.md` referenced by `AGENTS.md` as a living log, but currently only contains a template — no real entries.
- **Proposals:** Substantive design changes get a markdown proposal under `docs/proposals/` with implementation details, before/after interface diffs, and acceptance criteria. One example exists and was fully delivered.
- **Testing:** Vitest with suites colocated under `src/__tests__/`. ffmpeg interactions are mocked — real binaries should not be invoked in tests.
- **Formatting:** Prettier with 100-col width, single quotes, trailing commas. lowerCamelCase for variables/functions, PascalCase for types/classes.
- **Releases:** release-please drives version bumps automatically based on conventional commits. Husky runs pre-commit hooks.

## Quick Start for New Contributors

1. Install dependencies: `pnpm install`
2. Build all packages: `pnpm build`
3. Run tests: `pnpm test` (or `pnpm --filter @alien-lobster-buffet/tts-conductor-core test` to target one package)
4. Full local CI: `pnpm verify` (format-check + typecheck + lint + test)
5. Read for context:
   - `AGENTS.md` — repository conventions, session/lessons-learned practices
   - `docs/proposals/tts-interface-alignment.md` — the core↔provider contract and its rationale
   - `packages/tts-core/src/operations.ts` — the orchestration flow in one file

Note: ffmpeg/ffprobe must be available at runtime (provided via `ffmpeg-static` for the bundled binary); ElevenLabs integration requires `ELEVENLABS_API_KEY`.

## Key Insights

- **The point of this project is the contract, not the adapter.** `@alien-lobster-buffet/tts-conductor-core` was deliberately designed to be vendor-agnostic; the ElevenLabs package is one concrete proof of that contract. The interesting code is in `provider.ts`, `factory.ts`, `conductor.ts`, and `operations.ts`.
- **Provider ID flows through context, not constructors.** The conductor stamps `id` onto `TtsProviderContext` at `createProvider` time; providers assign `this.id = ctx.id`. This eliminates unsafe casts in the core's logging and keeps factory IDs and instance IDs in sync without duplication.
- **The core trusts providers with metadata.** `GenerationResult.duration` is optional; when present, the core skips ffprobe. This was the headline perf win from the 2025-09-29 interface alignment.
- **Stale spots worth knowing about:** the root `README.md` still references `tsup` (migrated to `tsdown`); `docs/lessons-learned.md` is a template with no real entries; both packages are `license: "UNLICENSED"` despite v1.1.0 release tooling being wired up. None are blockers, but worth a sweep when work resumes.

---

_This summary was generated by analyzing the codebase, documentation, and recent activity. It represents the actual state of the project as discovered, not just stated intentions. See `docs/reports/2026-05-22-project-summary-report.md` for the discovery process and findings._
