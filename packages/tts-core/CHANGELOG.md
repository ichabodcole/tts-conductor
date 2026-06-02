# Changelog

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
