# Repository Guidelines

## Project Structure & Module Organization

This Bun workspace hosts core orchestration and provider packages under `packages/`. Use `packages/tts-core/src` for reusable logic and utilities, `packages/tts-provider-elevenlabs/src` for ElevenLabs bindings, and the matching `__tests__` directories for Vitest suites. Distribution artifacts live in each package’s `dist/` folder and are regenerated via `bun --filter <pkg> run build`.

- **Docs**: Documents related to the design, architecture and development of the application.
  - Sessions: see `docs/sessions` for a history of previous work session captures.
  - Lessons Learned: see `docs/lessons-learned.md` for a living log of solved issues and preferred patterns.

## Build, Test, and Development Commands

Run `bun install` once to hydrate the workspace. Use `bun run build` to invoke Turbo’s build pipeline across packages, `bun run test` for the aggregated Vitest runs, and `bun --filter @tts-conductor/core run test` (or another filter) to target a single package. Formatting is applied with `bun run format` (write). `bun run lint` runs Biome’s combined lint + format check (`biome check --error-on-warnings .`); `bun run lint:fix` applies safe auto-fixes. `bun run check` (alias: `bun run verify`) runs typecheck + lint + tests as the pre-merge gate. Markdown is formatted separately with `bun run format:md` (Prettier).

## Coding Style & Naming Conventions

TypeScript is the canonical language; stick to lowerCamelCase for variables/functions and PascalCase for classes/types. Biome (see `biome.json`) governs layout and lint rules—100-character width, single quotes, trailing commas, semicolons always. Submit code that passes `bun run check` and avoid editing generated `dist/` files directly. Markdown is the one carve-out: it’s formatted by Prettier with defaults via `bun run format:md`.

## Testing Guidelines

Vitest drives unit tests; colocate files as `*.test.ts` beneath `src/__tests__/`. Ensure mocked ffmpeg interactions don’t hit the real binaries. Aim to cover chunking, segment parsing, and provider adapters before submitting a change. Run `bunx vitest run --config vitest.config.ts` (or `bun run test`) to reproduce the CI matrix locally.

## Commit & Pull Request Guidelines

Use concise, imperative commit messages (e.g., “Add ElevenLabs streaming adapter”). Keep logical changes isolated per commit. Pull requests should include: a summary of behavior, referenced issues (`Fixes #123`), test evidence (`bun run test` / `bun run check` output or screenshots), and notes about config or schema updates. Describe any external service requirements (API keys, ffmpeg paths) so reviewers can validate locally.

## Tooling & Environment Notes

The runtime requires Node ≥18.18 and ffmpeg/ffprobe availability. ElevenLabs integration expects `ELEVENLABS_API_KEY`; keep secrets out of commits. When debugging audio, configure the optional debug sink through `TtsRuntimeConfig` to capture intermediate buffers without polluting version control.

## Sessions

Purpose:

- Keep work transparent and reproducible by maintaining a lightweight session log in `docs/sessions/`.
- Make minimal, targeted changes; prefer adapting tests/docs over altering app logic unless necessary.
- Review `docs/sessions/README.md` for more information.

When Starting Work:

- Create or update a session document in `docs/sessions/`:
  - File name: `YYYY-MM-DD-short-topic.md` (e.g., `2025-09-06-upgrade-test-fix-session.md`).
  - If a same-day session exists for the topic, continue in that file.
- Use the plan tool to outline steps if work spans multiple actions or files.

## Lessons Learned

- Maintain `docs/lessons-learned.md` as a quick reference for recurring pitfalls and fixes.
- Add concise entries with symptom, environment (if relevant), fix pattern, and a minimal code example.
