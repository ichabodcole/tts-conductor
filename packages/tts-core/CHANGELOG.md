# Changelog

## [0.3.0-alpha.0](https://github.com/ichabodcole/tts-conductor/compare/@alien-lobster-buffet/tts-conductor-core-v0.2.0-alpha.0...@alien-lobster-buffet/tts-conductor-core-v0.3.0-alpha.0) (2026-06-02)


### Features

* 0.2.0-alpha.0 — pauseTable rename + createElevenLabsCatalog factory ([00cdc05](https://github.com/ichabodcole/tts-conductor/commit/00cdc05dc605dc436b6d63d45dc6cab3ee272700))
* **core,11labs:** expose audio Buffer and provider error taxonomy ([f2672bc](https://github.com/ichabodcole/tts-conductor/commit/f2672bc80366623545afbd86bcf90409947b94ec))
* **core,11labs:** per-call overrides for pauses, voice/settings, and chunking cap ([0c584a8](https://github.com/ichabodcole/tts-conductor/commit/0c584a8193328f8b68c14f8c48730df538820867))
* **core,11labs:** plumb AbortSignal through orchestration, providers, and ffmpeg ([a54f5e6](https://github.com/ichabodcole/tts-conductor/commit/a54f5e6ebba6a2ddbef087e94068061110fe2deb))
* **core,11labs:** voice catalog API (A6) ([d2fc6b5](https://github.com/ichabodcole/tts-conductor/commit/d2fc6b5235a29393575f0ae965a28c83a9bab912))
* **core:** generic per-chunk providerMeta passthrough + fal provider design ([2df10ef](https://github.com/ichabodcole/tts-conductor/commit/2df10ef72e94af8cf61e8e7c61d5642b35d857f4))
* **core:** per-call output format configurability (A7) ([dee6f99](https://github.com/ichabodcole/tts-conductor/commit/dee6f99a3045c47c2464eb72f528afddfc638030))
* **core:** richer lifecycle event API (A8) ([fa38d0e](https://github.com/ichabodcole/tts-conductor/commit/fa38d0e65c11d5bf35cfc4fd6ba416d3b77e6240))
* implement core tts package and eleven labs provider ([7e4c957](https://github.com/ichabodcole/tts-conductor/commit/7e4c957572cf839582b8f3cbd73d418ed60e186a))

## 0.2.0-alpha.0 — 2026-05-24

### Breaking Changes

- Renamed `TtsRuntimeConfig.pauses` → `TtsRuntimeConfig.pauseTable` and
  `BuildAudioOptions.pauses` → `BuildAudioOptions.pauseTable`. Behavior is
  unchanged — the per-call override still fully replaces the construction-time
  table. Migrate by renaming both call sites; one-line diff per consumer.

### Added

- README: BullMQ heartbeat pattern guidance under "Progress reporting and BullMQ
  heartbeats" — calls out that long jobs without `onProgress` wiring will trip
  BullMQ's stall detection and get retried mid-synthesis, wasting credits.
- README: new "Untrusted input safety" section documenting `maxPauseSeconds` as
  the safety bound for multi-tenant / user-authored inputs.
