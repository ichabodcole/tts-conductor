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
  /** Final MP3 encode. */
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
 * Default final-output format. Currently hardcoded at the stitcher; a future
 * per-call output config will let consumers pick Opus/FLAC/variable bitrates.
 */
export const DEFAULT_OUTPUT_FORMAT = {
  codec: 'libmp3lame',
  bitrate: '192k',
  sampleRateHz: 44100,
  channels: 1,
} as const;

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
