# TTS Conductor Monorepo

Reusable text-to-speech tooling. The workspace currently ships the shared orchestration core plus an ElevenLabs provider adapter.

## Tooling

- **pnpm workspaces** – dependency management across packages.
- **Turborepo** – orchestrates build, lint, and test tasks in parallel.
- **TypeScript** – shared compiler configuration via `tsconfig.base.json`.
- **tsup** – bundles package sources to `dist/` with type declarations.
- **ESLint (flat config)** – lint rules applied via `pnpm lint`.
- **Vitest** – workspace-aware test runner (test suites to be ported next).

## Structure

```
packages/
  tts-core/                  # parsing, chunking, FFmpeg stitching, provider registry
  tts-provider-elevenlabs/   # ElevenLabs SDK bridge implementing the core provider contract
```

## Packages

- **@tts-conductor/core** (`packages/tts-core`)
  - Exposes the orchestration runtime, pause parsing utilities, chunker, and FFmpeg-based stitcher.
  - Tests live in `packages/tts-core/src/__tests__`; run with `pnpm --filter @tts-conductor/core test`.
  - Build artifacts emit to `packages/tts-core/dist` via `pnpm --filter @tts-conductor/core build`.
- **@tts-conductor/provider-elevenlabs** (`packages/tts-provider-elevenlabs`)
  - Wraps the ElevenLabs JS SDK to satisfy the core `TtsProvider` contract, including duration probing.
  - Tests reside in `packages/tts-provider-elevenlabs/src/__tests__`; execute with `pnpm --filter @tts-conductor/provider-elevenlabs test`.
  - Depends on the core package via workspace protocol and outputs bundles to `packages/tts-provider-elevenlabs/dist`.

## Getting Started

1. Install dependencies: `pnpm install`
2. Build everything: `pnpm build`
3. Run linting: `pnpm lint`
4. Execute tests (placeholders for now): `pnpm test`

Refer to each package README for usage examples and configuration details.
