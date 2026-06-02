# Project Summary

**Last Updated:** 2026-05-24
**Project Status:** Active Development

## Overview

`tts-conductor` is a published-to-npm TypeScript library that orchestrates text-to-speech synthesis across pluggable providers. Application authors hand it a script (with optional inline pause markers like `[PAUSE:5s]` or `[PAUSE:BREATH]`), it parses, chunks the input within per-provider character limits, synthesizes each chunk through a provider adapter, and stitches the resulting audio segments together via ffmpeg into a single deliverable file with deterministic inter-chunk pauses.

The strategic positioning is "reusable orchestration core so application authors don't hand-roll the parse/chunk/stitch pipeline for every TTS surface." The provider abstraction is intentionally narrow — one generation method, one capabilities object, optional voice-catalog — so adding new providers (OpenAI TTS, Cartesia, Google) doesn't ripple into core changes.

Published as two npm packages under the `@alpha` tag as of 2026-05-24: `@alien-lobster-buffet/tts-conductor-core@0.2.0-alpha.0` and `@alien-lobster-buffet/tts-conductor-elevenlabs@0.2.0-alpha.1`. Two production consumers are integrating today: Story Loom (single-tenant guided storytelling) and Media Forge (multi-tenant TTS-as-a-service).

## Core Technologies

- **Primary Language:** TypeScript (5.x), targeting Node 18+
- **Runtime / package manager:** Bun 1.3.9, workspace pattern `packages/*`
- **Build orchestration:** Turborepo (task graph: `^build` is a dep of `typecheck`/`test`)
- **Bundler:** tsdown (rolldown-based, emits ESM + `.d.mts` declarations)
- **Linter/formatter:** Biome 2.x (replaced ESLint + Prettier in the 2026-05-22 migration)
- **Test runner:** Vitest (workspace-aware)
- **Audio pipeline:** ffmpeg / ffprobe via execa
- **Provider SDK:** `@elevenlabs/elevenlabs-js@^2.49.0` (for the bundled provider)

## Project Structure

```
packages/
  tts-core/                      # @alien-lobster-buffet/tts-conductor-core
    src/
      conductor.ts               # TtsConductor class
      config.ts                  # TtsRuntimeConfig, BuildAudioOptions
      defaults.ts                # OUTPUT_FORMATS, DEFAULT_PAUSE_TABLE
      errors.ts                  # TtsError + retry-classification subclasses
      events.ts                  # TtsEvent discriminated union
      factory.ts                 # provider registry / createProvider
      operations.ts              # ttsGenerateFull orchestration
      provider.ts                # TtsProvider interface
      voice-catalog.ts           # VoiceCatalog interface
      utils/                     # stitcher, chunker, segmenter, duration probing
      __tests__/

  tts-provider-elevenlabs/       # @alien-lobster-buffet/tts-conductor-elevenlabs
    src/
      elevenLabsProvider.ts      # SDK adapter, error mapping, stream-to-buffer
      voiceCatalog.ts            # ElevenLabsVoiceCatalog + createElevenLabsCatalog factory
      __tests__/

docs/                            # scaffold-template structure (migrated 2026-05-24)
  projects/<name>/{proposal.md, plan.md, sessions/}
  projects/_archive/<name>/      # completed projects
  backlog/                       # pre-publish backlog + deferred items
  architecture/  specifications/ playbooks/ lessons-learned/ memories/
  briefs/  fragments/  interaction-design/  investigations/  reports/
```

Two-package monorepo. The core package has no SDK dependencies; the provider package wraps the ElevenLabs SDK and satisfies the core's `TtsProvider` contract. Future providers will follow the same shape (one package per provider, peerDep on core).

## Documented Systems

No architecture documents have been written yet. The patterns evidenced in code and session notes are worth formalizing in a future architecture pass:

- **Provider-as-isolation-boundary** — all SDK-specific concerns live in the provider package; the core knows nothing about ElevenLabs. The SDK 1→2 migration was invisible to consumers, validating the boundary.
- **Parse → chunk → synthesize → stitch pipeline** — the deterministic orchestration that `ttsGenerateFull` runs.
- **Full-replace override semantics** — per-call overrides (`voiceSettings`, `pauseTable`) replace construction-time values entirely. Documented in code comments but not yet in a formal architecture doc.

(Recommended for the next architecture sweep — see the discovery report.)

## Application Specifications

No application specifications expected — this is a library, not an application. `docs/specifications/` is scaffolded but intentionally empty.

## Recent Activity (Last 30 Days)

All 22 commits in the last 30 days cluster in 2026-05-22 → 2026-05-24. The project went from pre-publish hardening to two alpha versions in production with two real consumers in roughly 72 hours.

**Active Work Areas:**

- **alpha-release coordination** — alpha.0 → alpha.0.2 → alpha.1 hotfix → publish-build-safety hardening, with two production consumers integrating in parallel
- **Doc-structure migration** — flat `docs/` to scaffold-template structure (this commit)

**Recent Sessions:**

- 2026-05-24 — `pause-table-rename-and-catalog-factory-session` (alpha.0.2 release, see `projects/multi-tenant-pauses-and-catalog/sessions/`)
- 2026-05-24 — `publish-build-safety-session` (closing the stale-dist failure mode, see `projects/publish-build-safety/sessions/`)
- 2026-05-23 — 11 archived sessions documenting the alpha.0 pre-publish hardening sprint (see `projects/_archive/alpha-0-publish-prep/sessions/`)

**Notable Changes:**

- `pauses` → `pauseTable` rename (breaking, alpha-window only) on both `TtsRuntimeConfig` and `BuildAudioOptions`, ack-gated by both alpha consumers via Agent Bridge before publish
- `createElevenLabsCatalog(apiKey)` factory added to `-elevenlabs`, removing the consumer-side duplicate-SDK-dep trap
- Publish system hardened: `prepublishOnly: tsdown` on both packages; `dist/` gitignored; turbo `typecheck` rewired to `^build` so cold-start workflows resolve correctly

## Current Direction

**Active Projects:**

- `multi-tenant-pauses-and-catalog` — shipped as `0.2.0-alpha.0` + alpha.1; in production at both consumers (see `docs/projects/multi-tenant-pauses-and-catalog/`)
- `publish-build-safety` — shipped on develop (this branch); activates on next publish (see `docs/projects/publish-build-safety/`)

**In Progress Investigations:** None.

**Backlog highlights** (`docs/backlog/deferred-items.md`):

- `usage` field on `GenerationResult` (requested by Media Forge for per-tenant billing)
- Audio-primitives package extraction (`mp3ToWav` / `concatenateAudio` for non-synthesis consumers; requested by Story Loom)
- Several polish items (eager-`base64Data` deprecation, ffprobe-per-chunk doc emphasis, etc.)

The library is in its **breaking-change window**. Alpha cadence will continue while the API stabilizes; expect `0.3.0-alpha.x` whenever the next batch of consumer-feedback-driven shape changes lands. 1.0 will follow once the API surface has stabilized across multiple consumers.

## Development Patterns & Practices

- **Bridge-coordinated alpha releases.** Breaking changes are pre-coordinated with both alpha consumers via Agent Bridge thread. Both consumers must ack the change before publish. Pattern is repeatable but not yet captured as a formal playbook.
- **Proposal → plan → session triad** per project. Every shipped change has a `proposal.md` (the why), a `plan.md` (the how, when complex enough), and one or more `sessions/<date>-*.md` files (the durable record of what actually happened).
- **Independent code review via subagent.** Even when one agent fills both strategist and engineer roles, the code review step is dispatched to a separate subagent (`feature-dev:code-reviewer`) for fresh-eyes review.
- **Manual `npm publish`** from Cole's account (no CI publish yet). `prepublishOnly` script ensures fresh build at publish time.
- **Playbooks:** None in this repo. The "Publishing a Bun workspace to npm" playbook lives in Hivemind (extracted from this project's first publish).
- **Lessons Learned:** Empty in this repo. Captured material lives in session docs and the deferred-items backlog.

## Quick Start for New Contributors

1. Install dependencies: `bun install`
2. Build (regenerates `dist/` for both packages): `bun run build`
3. Full gate (typecheck + lint + tests): `bun run check`
4. Run tests for one package: `bun run --filter @alien-lobster-buffet/tts-conductor-core test`
5. Read key docs:
   - `docs/projects/multi-tenant-pauses-and-catalog/proposal.md` — the most recent shipped change, gives a sense of the API surface
   - `docs/backlog/deferred-items.md` — what's queued for post-alpha triage
   - `packages/tts-core/README.md` and `packages/tts-provider-elevenlabs/README.md` — package-level consumer-facing docs

## Key Insights

- **Provider-as-isolation-boundary is load-bearing.** The ElevenLabs SDK 1→2 migration touched only the provider package, never the core. Future SDK churn (when ElevenLabs ships a 3.x, when Cartesia/OpenAI providers get added) should benefit from the same pattern. Don't compromise the boundary for short-term convenience.
- **The 2026-05-23 sprint was an exception, not the cadence.** 11 named sessions in one day was the pre-publish push, not a sustainable rhythm. Steady state should be one focused project at a time, ack-gated with consumers on breaking changes.
- **Multi-consumer alpha testing surfaces what single-consumer testing misses.** The convergent ask on the `pauseTable` name from both Story Loom and Media Forge was the load-bearing signal that justified the breaking rename. Single-consumer feedback would have left it ambiguous.
- **Build-system failure modes need belt-and-suspenders.** The alpha.1 hotfix root-caused to a layering issue (committed dist drifted from source). The publish-build-safety fix lives at three layers (turbo task ordering, `prepublishOnly`, gitignored `dist/`) because no single layer was sufficient. Generalize: trust the source as the only authoritative copy; derive everything else fresh.

---

_This summary was generated by analyzing the codebase, documentation, and recent activity. It represents the actual state of the project as discovered, not just stated intentions._
