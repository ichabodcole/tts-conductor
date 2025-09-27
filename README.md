# TTS Conductor Monorepo

Scaffolding for a pnpm-based workspace that will eventually host the reusable TTS libraries extracted from the Hypnotyche app.

## Tooling
- **pnpm workspaces** – dependency management across packages.
- **Turborepo** – orchestrates build, lint, and test tasks in parallel.
- **TypeScript** – shared compiler configuration via `tsconfig.base.json`.
- **tsup** – bundles package sources to `dist/` with type declarations.
- **ESLint (flat config)** – lint rules applied via `pnpm lint`.
- **Vitest** – test runner configured as a workspace via `vitest.config.ts`.

## Structure
```
packages/
  tts-core/                  # shared orchestration primitives (placeholder)
  tts-provider-elevenlabs/   # provider adapter skeleton (placeholder)
```

## Getting Started
1. Install dependencies: `pnpm install`
2. Build everything: `pnpm build`
3. Run linting: `pnpm lint`
4. Execute tests: `pnpm test`

> The code is intentionally minimal while the extraction plan is refined. Each package contains placeholder exports so downstream projects can start wiring references before the full implementation lands.
