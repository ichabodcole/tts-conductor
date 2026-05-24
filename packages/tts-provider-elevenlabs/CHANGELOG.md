# Changelog

## 0.2.0-alpha.1 — 2026-05-24

### Fixed

- Republished `dist/` artifacts to include the `createElevenLabsCatalog`
  factory export. The `0.2.0-alpha.0` artifact shipped with the source-level
  export but a stale compiled `dist/` that pre-dated the factory addition,
  causing `TS2305: Module has no exported member 'createElevenLabsCatalog'`
  at every consumer import site. No source change; the dist was rebuilt
  against the same source code present in `0.2.0-alpha.0`.

## 0.2.0-alpha.0 — 2026-05-24

### Breaking Changes

- Bumped `peerDependencies["@alien-lobster-buffet/tts-conductor-core"]` from
  `^0.1.0-alpha.0` to `^0.2.0-alpha.0`. Consumers must upgrade both packages
  together because the core rename `pauses` → `pauseTable` flows through the
  shared `TtsRuntimeConfig` type.

### Added

- `createElevenLabsCatalog(apiKey)` factory — construct an
  `ElevenLabsVoiceCatalog` without importing `@elevenlabs/elevenlabs-js`
  directly. Removes the duplicate-SDK-dependency trap for consumers that only
  need the voice catalog. `ElevenLabsVoiceCatalog` remains exported and
  constructable for advanced use cases.
