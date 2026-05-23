# TTS Conductor Monorepo

Reusable text-to-speech tooling. The workspace currently ships the shared orchestration core plus an ElevenLabs provider adapter.

## Tooling

- **Bun workspaces** – dependency management across packages.
- **Turborepo** – orchestrates build, lint, and test tasks in parallel.
- **TypeScript** – shared compiler configuration via `tsconfig.base.json`.
- **tsdown** – bundles package sources to `dist/` with type declarations.
- **ESLint (flat config)** – lint rules applied via `bun run lint`.
- **Vitest** – workspace-aware test runner.

## Structure

```
packages/
  tts-core/                  # parsing, chunking, FFmpeg stitching, provider registry
  tts-provider-elevenlabs/   # ElevenLabs SDK bridge implementing the core provider contract
```

## Packages

- **@tts-conductor/core** (`packages/tts-core`)
  - Exposes the orchestration runtime, pause parsing utilities, chunker, and FFmpeg-based stitcher.
  - Tests live in `packages/tts-core/src/__tests__`; run with `bun --filter @tts-conductor/core run test`.
  - Build artifacts emit to `packages/tts-core/dist` via `bun --filter @tts-conductor/core run build`.
- **@tts-conductor/provider-elevenlabs** (`packages/tts-provider-elevenlabs`)
  - Wraps the ElevenLabs JS SDK to satisfy the core `TtsProvider` contract, including duration probing.
  - Tests reside in `packages/tts-provider-elevenlabs/src/__tests__`; execute with `bun --filter @tts-conductor/provider-elevenlabs run test`.
  - Depends on the core package via workspace protocol and outputs bundles to `packages/tts-provider-elevenlabs/dist`.

## Getting Started

1. Install dependencies: `bun install`
2. Build everything: `bun run build`
3. Run linting: `bun run lint`
4. Execute tests: `bun run test`

Refer to each package README for usage examples and configuration details.
