# 2026-05-23 — Per-call output format configurability (A7)

## Goals

Let consumers pick the final-encode output format per call — MP3 (multiple bitrates), Opus (mono / stereo), FLAC, WAV — without forking the stitcher. Plugs into the `DEFAULT_OUTPUT_FORMAT` scaffolding from the config-sweep branch.

Per `docs/backlog.md` item A7. The previous branch (config sweep) extracted the audio format constants and added `-ac` plumbing specifically so this branch could slot in cleanly.

## Completed Work

### `OutputFormat` interface + `OUTPUT_FORMATS` presets

New `OutputFormat` shape in `defaults.ts`:

```ts
interface OutputFormat {
  codec: string; // ffmpeg -c:a
  bitrate?: string; // -b:a for lossy; omit for lossless
  sampleRateHz: number; // -ar
  channels: number; // -ac
  container: string; // file extension hint
  mimeType: string; // surfaced on BuildFinalAudioResult.mimeType
}
```

Preset constants in `OUTPUT_FORMATS`:

- `MP3_64`, `MP3_128`, `MP3_192` (default), `MP3_320` — spoken-word and music-quality MP3
- `OPUS_64`, `OPUS_128_STEREO` — bandwidth-tight delivery
- `FLAC` — lossless archive
- `WAV` — raw PCM

`DEFAULT_OUTPUT_FORMAT` is now aliased to `OUTPUT_FORMATS.MP3_192` (matching prior behavior).

### `BuildAudioOptions.output?: OutputFormat`

Per-call hook. Full object required (no `Partial<OutputFormat>` — mismatched codec/container/mimeType would silently produce wrong files). Consumers wanting partial customization spread a preset:

```ts
{ output: { ...OUTPUT_FORMATS.MP3_192, bitrate: '320k', channels: 2 } }
{ output: { ...OUTPUT_FORMATS.OPUS_64, bitrate: '96k' } }
```

### Threading

`buildFinalAudio` resolves `outputFormat = options?.output ?? DEFAULT_OUTPUT_FORMAT` once at entry. Final-encode args built dynamically — `-b:a` only emitted when the format has a `bitrate` (lossless codecs omit it correctly, no misleading log noise).

Default filename now derives container from format (`tts_<ts>.opus` for Opus, `.flac` for FLAC). Consumer-supplied filename is honored verbatim — documented as consumer's responsibility to match the format.

`BuildFinalAudioResult.mimeType` flows through from `outputFormat.mimeType`.

### New exports from core

- `OUTPUT_FORMATS` (constant)
- `OutputFormat` (type)

### Behavior contract

Default behavior unchanged at default settings. All pre-existing tests pass without modification — A7 is purely additive at the consumer-supplied surface.

## Verification

`bun run check` (typecheck + Biome `--error-on-warnings` + 79 tests) green on the final state.

## Code Review

Dispatched `feature-dev:code-reviewer` against the net diff. Verdict: **"Ready to merge: With fixes."** Two important findings + two minor enhancements, all addressed:

**Important fix 1: Opus MIME type was wrong.** I used `audio/opus` (RFC 7587, raw RTP Opus bitstream — for streaming protocols) but ffmpeg's `.opus` files are Ogg-wrapped, so the correct IANA MIME type is `audio/ogg; codecs=opus` (RFC 7845). Browsers and MIME-aware consumers would have rejected the `audio/opus` content-type for an Ogg-Opus file. Fixed in both Opus presets.

**Important fix 2: Stale "Final MP3 encode" comments** on `DEFAULT_TIMEOUTS.finalEncode` in `defaults.ts` and the corresponding field in the `TtsTimeouts` interface in `config.ts`. Both fields now govern any codec, not just MP3. Updated to "Final audio encode (codec determined by the resolved OutputFormat)."

**Reviewer's additional considerations (incorporated):**

- Added `MP3_64` preset — the obvious spoken-word small-file case, directly relevant for narration/hypnosis content where 64kbps is plenty.
- Added a stereo-limitation note on `OPUS_128_STEREO`. The intermediate-audio pipeline is always 44.1kHz mono pcm_s16le (required for ffmpeg concat-demuxer reliability), so `channels: 2` duplicates the mono signal across both channels rather than producing real spatial stereo. Documented as a known limitation; future real-stereo support would require a different intermediate pipeline.
- Added a test asserting consumer-supplied `fileName` is honored verbatim even when the output format would imply a different extension (e.g., Opus codec + `.mp3` filename produces an `.mp3` file). This is the foot-gun behavior I documented; the test pins it down.

**Reviewer's notes I did NOT act on:**

- AAC preset (libfdk_aac or ffmpeg's native aac) — real gap for iOS/Safari delivery but adding it now is scope creep. Worth noting as a backlog candidate.
- Filename-extension-mismatch warning when consumer supplies a filename that doesn't match the format's container. The reviewer described it as a "consumer FAQ" prevention measure. Documented foot-gun for now; could add the warning in a docs polish pass.
- Pre-existing temp-file collision (backlog V4, `stitcher.ts:250-251`) — not introduced here, deferred to the verification batch.

## Outcomes

Consumers now have a clean, ergonomic per-call output format surface. The default behavior is unchanged. The codec/container/mimeType triad is structurally coherent via presets and documented as a contract for custom formats. A7 is complete.

## Files Modified

- `packages/tts-core/src/defaults.ts` — `OutputFormat` interface + 7 presets + updated DEFAULT_OUTPUT_FORMAT alias + corrected Opus MIME types + finalEncode JSDoc fix
- `packages/tts-core/src/config.ts` — `BuildAudioOptions.output?` + `TtsTimeouts.finalEncode` JSDoc fix + `OutputFormat` import
- `packages/tts-core/src/utils/stitcher.ts` — resolved `outputFormat` at entry, dynamic final-encode args, container-derived filename, mimeType flows from format
- `packages/tts-core/src/index.ts` — exports for `OUTPUT_FORMATS` + `OutputFormat`
- `packages/tts-core/src/__tests__/stitcher.test.ts` — 6 new A7 tests
- `packages/tts-core/dist/*` — rebuilt for workspace typecheck

## Follow-ups

- **AAC preset** (libfdk_aac or aac codec, m4a container, audio/mp4 mime) for iOS/Safari delivery — real consumer ask, not in scope for this branch.
- **Filename extension validation warning** — log a `logger.warn` when consumer-supplied filename's extension doesn't match `outputFormat.container`. Cheap prevention against a documented foot-gun.
- **Real stereo TTS support** — would require a different intermediate-audio pipeline (skip concat demuxer, or per-input normalization). Out of scope; flagged in OPUS_128_STEREO JSDoc.
- Pre-existing temp-file collision under concurrency (`backlog V4`) is still pending in the verification batch.
- `ElevenLabsClientMock.mockReset()` defensive refactor still pending (carried forward).
