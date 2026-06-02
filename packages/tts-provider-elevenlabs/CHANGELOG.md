# Changelog

## [0.3.0-alpha.1](https://github.com/ichabodcole/tts-conductor/compare/@alien-lobster-buffet/tts-conductor-elevenlabs-v0.2.0-alpha.1...@alien-lobster-buffet/tts-conductor-elevenlabs-v0.3.0-alpha.1) (2026-06-02)


### Features

* 0.2.0-alpha.0 — pauseTable rename + createElevenLabsCatalog factory ([00cdc05](https://github.com/ichabodcole/tts-conductor/commit/00cdc05dc605dc436b6d63d45dc6cab3ee272700))
* **core,11labs:** expose audio Buffer and provider error taxonomy ([f2672bc](https://github.com/ichabodcole/tts-conductor/commit/f2672bc80366623545afbd86bcf90409947b94ec))
* **core,11labs:** per-call overrides for pauses, voice/settings, and chunking cap ([0c584a8](https://github.com/ichabodcole/tts-conductor/commit/0c584a8193328f8b68c14f8c48730df538820867))
* **core,11labs:** plumb AbortSignal through orchestration, providers, and ffmpeg ([a54f5e6](https://github.com/ichabodcole/tts-conductor/commit/a54f5e6ebba6a2ddbef087e94068061110fe2deb))
* **core,11labs:** voice catalog API (A6) ([d2fc6b5](https://github.com/ichabodcole/tts-conductor/commit/d2fc6b5235a29393575f0ae965a28c83a9bab912))
* implement core tts package and eleven labs provider ([7e4c957](https://github.com/ichabodcole/tts-conductor/commit/7e4c957572cf839582b8f3cbd73d418ed60e186a))


### Bug Fixes

* **11labs:** publish 0.2.0-alpha.1 with rebuilt dist (factory export) ([ce5e768](https://github.com/ichabodcole/tts-conductor/commit/ce5e768df1ac86265462beacec06549d0d1dcebc))

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
