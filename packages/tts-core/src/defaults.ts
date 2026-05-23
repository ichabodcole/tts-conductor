import type { PauseTable } from './utils/pause';

export const DEFAULT_PAUSE_TABLE: PauseTable = {
  MICRO: 0.5,
  SHORT: 1.5,
  MEDIUM: 3.5,
  LONG: 8,
  FULL_BREATH: 5,
  HALF_BREATH: 3,
  SETTLE: 10,
  BREATH: 5,
};

/**
 * Default timeouts (milliseconds) for each waited operation in the orchestration
 * pipeline. Consumers can override any subset of these via
 * {@link TtsRuntimeConfig.timeouts}; whatever they don't supply falls back here.
 *
 * Values reflect what the library historically hardcoded and have proven
 * reasonable in production for ElevenLabs at typical chunk sizes (~1200 chars).
 * Long segments, slow upstream days, or larger chunk budgets may want higher
 * values — that's exactly what the override surface is for.
 */
export const DEFAULT_TIMEOUTS = {
  /** Per-chunk provider.generate() wrapping timeout (entire upstream call). */
  generate: 60_000,
  /** Per-chunk ffmpeg transcode (MP3 → intermediate WAV). */
  transcode: 30_000,
  /** Silence-WAV generation (cached after first build per duration). */
  silenceGen: 30_000,
  /** Concat-demuxer concatenation (fast path). */
  concat: 45_000,
  /** Filter-graph concat fallback (slower, re-encodes from scratch). */
  concatFilterFallback: 60_000,
  /** Final audio encode (codec determined by the resolved OutputFormat). */
  finalEncode: 45_000,
  /** Outer wrap around buildFinalAudio inside the orchestration. */
  stitch: 45_000,
} as const;

/**
 * Internal intermediate-audio pipeline parameters. These are NOT user-configurable
 * because they're chosen to make ffmpeg's concat demuxer behave reliably —
 * mismatched sample rates or codecs between intermediate parts cause crackling
 * or hard concat failures. The pipeline does MP3 → 44.1kHz mono pcm_s16le WAV →
 * concat → final-output-format.
 *
 * The final output format is a separate concern (see {@link DEFAULT_OUTPUT_FORMAT})
 * and is targeted for per-call configurability in a follow-up.
 */
export const INTERMEDIATE_AUDIO = {
  sampleRateHz: 44100,
  channels: 1,
  codec: 'pcm_s16le',
} as const;

/**
 * Shape of a final-output format. Consumers either pick a preset from
 * {@link OUTPUT_FORMATS} or compose their own. The full object is required —
 * we deliberately do NOT accept `Partial<OutputFormat>` because mismatched
 * fields (e.g., Opus codec with MP3 container) silently produce wrong files.
 *
 * For custom-but-similar variants, spread a preset and override specific
 * fields, keeping the codec / container / mimeType triad coherent:
 *
 *   const customOpus = { ...OUTPUT_FORMATS.OPUS_64, bitrate: '96k' };
 *
 * Fields:
 * - `codec` — ffmpeg codec name passed to `-c:a` (e.g., `libmp3lame`,
 *   `libopus`, `flac`, `pcm_s16le`).
 * - `bitrate` — bitrate string passed to `-b:a` for lossy codecs (`'128k'`,
 *   `'192k'`, `'320k'`). Omit for lossless codecs (FLAC, PCM) — the field
 *   should be undefined in those presets.
 * - `sampleRateHz` — sample rate in Hz passed to `-ar` (44100, 48000, etc.).
 * - `channels` — channel count passed to `-ac` (1 = mono, 2 = stereo).
 * - `container` — file extension (without dot) and ffmpeg container name.
 *   Determines the output filename suffix.
 * - `mimeType` — MIME type surfaced on `BuildFinalAudioResult.mimeType`.
 */
export interface OutputFormat {
  codec: string;
  bitrate?: string;
  sampleRateHz: number;
  channels: number;
  container: string;
  mimeType: string;
}

/**
 * Preset output formats covering the common consumer cases. Use one directly:
 *
 *   conductor.generateFull(text, provider, undefined, { output: OUTPUT_FORMATS.OPUS_64 });
 *
 * Or spread + override for variants (keep codec/container/mimeType coherent):
 *
 *   { output: { ...OUTPUT_FORMATS.MP3_192, channels: 2 } }   // stereo MP3
 *   { output: { ...OUTPUT_FORMATS.OPUS_64, bitrate: '96k' } } // higher-quality Opus
 *
 * Notes on the picks:
 * - Opus presets use 48kHz because Opus is designed around 48kHz internally
 *   (lower rates get upsampled, wasting bits).
 * - FLAC and WAV presets omit `bitrate` because they're lossless; supplying
 *   a bitrate to ffmpeg for these codecs is silently ignored.
 * - Default sample rate is 44.1kHz / mono — matches ElevenLabs' standard
 *   MP3 output and the intermediate-audio pipeline.
 */
export const OUTPUT_FORMATS = {
  /** Spoken-word small-file MP3 — ~half the size of MP3_128 with little quality loss for narration. */
  MP3_64: {
    codec: 'libmp3lame',
    bitrate: '64k',
    sampleRateHz: 44100,
    channels: 1,
    container: 'mp3',
    mimeType: 'audio/mpeg',
  },
  MP3_128: {
    codec: 'libmp3lame',
    bitrate: '128k',
    sampleRateHz: 44100,
    channels: 1,
    container: 'mp3',
    mimeType: 'audio/mpeg',
  },
  MP3_192: {
    codec: 'libmp3lame',
    bitrate: '192k',
    sampleRateHz: 44100,
    channels: 1,
    container: 'mp3',
    mimeType: 'audio/mpeg',
  },
  MP3_320: {
    codec: 'libmp3lame',
    bitrate: '320k',
    sampleRateHz: 44100,
    channels: 1,
    container: 'mp3',
    mimeType: 'audio/mpeg',
  },
  OPUS_64: {
    codec: 'libopus',
    bitrate: '64k',
    sampleRateHz: 48000,
    channels: 1,
    container: 'opus',
    // `audio/opus` (RFC 7587) is the raw RTP bitstream MIME; ffmpeg's `.opus`
    // files are Ogg-wrapped and the IANA-correct type is `audio/ogg; codecs=opus`.
    mimeType: 'audio/ogg; codecs=opus',
  },
  /**
   * Stereo Opus preset. Note: the intermediate pipeline is always 44.1kHz
   * mono pcm_s16le (required for ffmpeg concat-demuxer reliability), so
   * `channels: 2` here duplicates the mono signal across both channels —
   * the output file is technically stereo but carries no spatial information.
   * Real stereo TTS would require a different intermediate pipeline.
   */
  OPUS_128_STEREO: {
    codec: 'libopus',
    bitrate: '128k',
    sampleRateHz: 48000,
    channels: 2,
    container: 'opus',
    mimeType: 'audio/ogg; codecs=opus',
  },
  /**
   * AAC preset using ffmpeg's native `aac` encoder (always available in
   * standard ffmpeg builds). Container is `m4a` (MP4 audio), MIME is
   * `audio/mp4`. Targets iOS/Safari and Apple Podcasts delivery, where AAC
   * is the native lane.
   *
   * Note: `libfdk_aac` is higher-quality than ffmpeg's native `aac` encoder
   * but is GPL-incompatible and rarely shipped in distributions. Consumers
   * who have it and want it can compose a custom `OutputFormat` with
   * `codec: 'libfdk_aac'`.
   */
  AAC_128: {
    codec: 'aac',
    bitrate: '128k',
    sampleRateHz: 44100,
    channels: 1,
    container: 'm4a',
    mimeType: 'audio/mp4',
  },
  FLAC: {
    codec: 'flac',
    sampleRateHz: 44100,
    channels: 1,
    container: 'flac',
    mimeType: 'audio/flac',
  },
  WAV: {
    codec: 'pcm_s16le',
    sampleRateHz: 44100,
    channels: 1,
    container: 'wav',
    mimeType: 'audio/wav',
  },
} as const satisfies Record<string, OutputFormat>;

/**
 * Default final-output format. MP3 at 192kbps / 44.1kHz / mono — matches what
 * the library has historically produced. Consumers can pick a different preset
 * from {@link OUTPUT_FORMATS} or compose a custom {@link OutputFormat} via
 * {@link BuildAudioOptions.output}.
 */
export const DEFAULT_OUTPUT_FORMAT: OutputFormat = OUTPUT_FORMATS.MP3_192;

/**
 * SSML wrapper overhead reserved when computing the per-chunk character budget.
 * The chunker fits raw text into `caps.maxCharsPerRequest - SSML_RESERVE_CHARS`
 * so the eventual SSML wrap (e.g., `<speak>...</speak>` plus inline `<break>`
 * tags) fits inside the provider's actual character limit.
 *
 * Tuned for the typical SSML overhead — `<speak></speak>` is 15 chars and break
 * tags are emitted by `renderInlineBreak`. 16 is a small conservative margin
 * above the bare-minimum 15.
 */
export const SSML_RESERVE_CHARS = 16;

/**
 * Default bitrate (kbps) used by {@link estimateAudioDuration} when the consumer
 * doesn't supply one. 128 matches ElevenLabs' standard `mp3_44100_128` output.
 */
export const DEFAULT_ESTIMATED_BITRATE_KBPS = 128;
