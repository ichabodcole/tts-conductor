import type { ElevenLabs as ElevenLabsTypes } from '@elevenlabs/elevenlabs-js';
import {
  ElevenLabsClient,
  ElevenLabsError,
  ElevenLabsTimeoutError,
} from '@elevenlabs/elevenlabs-js';
import type {
  GenerateCallOptions,
  GenerationResult,
  ProviderCapabilities,
  TtsProvider,
  TtsProviderContext,
  TtsProviderFactory,
  VoiceCatalog,
} from '@tts-conductor/core';
import {
  getAudioDuration,
  TtsAuthenticationError,
  TtsError,
  TtsInvalidInputError,
  TtsQuotaExceededError,
  TtsRateLimitError,
  TtsTransientError,
} from '@tts-conductor/core';
import { type ElevenLabsRawVoice, ElevenLabsVoiceCatalog } from './voiceCatalog';

/**
 * Voice settings for ElevenLabs TTS calls. Field names match the
 * `@elevenlabs/elevenlabs-js` SDK's camelCase TS interface exactly — the SDK
 * transforms camelCase to the API's wire-level snake_case internally.
 *
 * Passing snake_case keys (e.g., `similarity_boost: 0.8`) was silently dropped
 * by the SDK in earlier versions of this adapter because the SDK reads
 * `obj.similarityBoost` and finds undefined. Field names are camelCase here
 * to make that bug structurally impossible.
 */
export interface ElevenLabsVoiceSettings {
  stability?: number | null;
  useSpeakerBoost?: boolean | null;
  similarityBoost?: number | null;
  style?: number | null;
  speed?: number | null;
}

export type ElevenLabsQuality = 'draft' | 'standard' | 'high';

export interface ElevenLabsProviderOptions {
  apiKey: string;
  voiceId: string;
  voiceSettings?: ElevenLabsVoiceSettings;
  quality?: ElevenLabsQuality;
}

/**
 * Per-call overrides for `ElevenLabsProvider.generate()`. Carries the subset
 * of construction-time options that are safe to vary per request — `apiKey`
 * stays bound at construction since a different API key is conceptually a
 * different provider instance.
 *
 * Useful for slot-versioning use cases (A/B testing a voice on the same
 * source text, regenerating one segment with different settings) without
 * spinning up a fresh provider instance per variation.
 */
export interface ElevenLabsCallOverrides {
  voiceId?: string;
  /**
   * Per-call voice settings.
   *
   * **Replaces** the construction-time `voiceSettings` in full — this is NOT a
   * shallow merge. If you pass `{ stability: 0.9 }`, any other construction-time
   * settings (`speed`, `style`, `similarityBoost`, etc.) are dropped for this
   * call. Pass every field you want active on the call, not just the ones you
   * want to change. Full replacement keeps the override deterministic across
   * future SDK additions.
   */
  voiceSettings?: ElevenLabsVoiceSettings;
  quality?: ElevenLabsQuality;
}

// Register the ElevenLabs provider in the type registries
declare module '@tts-conductor/core' {
  interface TtsProviderRegistry {
    '11labs': ElevenLabsProviderOptions;
  }
  interface TtsProviderCallOverridesRegistry {
    '11labs': ElevenLabsCallOverrides;
  }
}

/**
 * ElevenLabs adapter defaults. These are the values the adapter reports to the
 * orchestrator and uses in SDK calls when the consumer doesn't override them.
 *
 * Consumer-configurable knobs (per-call overrides via `ElevenLabsCallOverrides`
 * or `BuildAudioOptions`):
 *   - voiceId, voiceSettings, quality (via overrides)
 *   - maxCharsPerRequest (via BuildAudioOptions.maxCharsPerRequest)
 *
 * Currently fixed (will become configurable when output-format config lands):
 *   - DEFAULT_OUTPUT_FORMAT — `mp3_44100_128` is ElevenLabs' standard MP3 at
 *     128kbps / 44.1kHz mono. Matches what the core stitcher's intermediate
 *     pipeline assumes (44.1kHz mono).
 *
 * Provider-shape (not appropriate to make per-call configurable):
 *   - DEFAULT_MAX_INLINE_BREAK_SECONDS — informs the chunker about ElevenLabs'
 *     `<break time="Xs"/>` upper bound.
 *   - MODEL_IDS — the actual SDK model identifiers per quality tier.
 */
export const ELEVENLABS_DEFAULTS = {
  /**
   * Default per-request character budget reported via `caps.maxCharsPerRequest`.
   * ElevenLabs' actual server limit is higher (~5000), but a smaller default
   * gives better latency / progress granularity for typical narration workloads.
   * Consumers tuning for throughput can override via
   * {@link BuildAudioOptions.maxCharsPerRequest}.
   */
  maxCharsPerRequest: 1200,
  /**
   * Maximum length of an inline `<break time="Xs"/>` tag the adapter promises
   * to handle correctly. Longer pauses get rendered as separate silence
   * segments by the core orchestrator.
   */
  maxInlineBreakSeconds: 3,
  /**
   * Default output format string passed to `textToSpeech.convert`. MP3 at
   * 44.1kHz / 128kbps — matches the core's intermediate-audio pipeline.
   */
  outputFormat: 'mp3_44100_128' as const,
  /**
   * Quality-tier → SDK model ID mapping. `high` deliberately maps to the same
   * model as `standard` because `eleven_multilingual_v2` is the highest-quality
   * model ElevenLabs currently exposes for this use case; `draft` swaps to the
   * faster turbo model.
   */
  models: {
    draft: 'eleven_turbo_v2_5',
    standard: 'eleven_multilingual_v2',
    high: 'eleven_multilingual_v2',
  } as const satisfies Record<ElevenLabsQuality, string>,
};

const CAPS: ProviderCapabilities = {
  maxInlineBreakSeconds: ELEVENLABS_DEFAULTS.maxInlineBreakSeconds,
  maxCharsPerRequest: ELEVENLABS_DEFAULTS.maxCharsPerRequest,
  renderInlineBreak: (seconds: number) => `<break time="${seconds}s" />`,
};

class ElevenLabsProvider implements TtsProvider<ElevenLabsCallOverrides> {
  readonly id: string;
  readonly caps = CAPS;
  readonly voiceCatalog: VoiceCatalog<ElevenLabsRawVoice>;
  private client: ElevenLabsClient;

  constructor(
    private readonly ctx: TtsProviderContext,
    private readonly options: ElevenLabsProviderOptions,
  ) {
    this.id = ctx.id;
    this.client = new ElevenLabsClient({ apiKey: options.apiKey });
    this.voiceCatalog = new ElevenLabsVoiceCatalog(this.client);
  }

  async generate(
    chunk: string,
    options?: GenerateCallOptions<ElevenLabsCallOverrides>,
  ): Promise<GenerationResult> {
    // Per-call overrides win over construction-time options. apiKey is
    // deliberately not part of ElevenLabsCallOverrides — a different API
    // key is a different provider instance.
    const overrides = options?.overrides;
    const signal = options?.signal;
    signal?.throwIfAborted();

    const voiceId = overrides?.voiceId ?? this.options.voiceId;
    const quality = overrides?.quality ?? this.options.quality ?? 'standard';
    const voiceSettings = overrides?.voiceSettings ?? this.options.voiceSettings;
    const logger = this.ctx.config.logger;

    const convertOptions: ElevenLabsTypes.BodyTextToSpeechFull = {
      text: chunk,
      outputFormat: ELEVENLABS_DEFAULTS.outputFormat,
      modelId: ELEVENLABS_DEFAULTS.models[quality] ?? ELEVENLABS_DEFAULTS.models.standard,
    };

    if (voiceSettings) {
      convertOptions.voiceSettings = voiceSettings as ElevenLabsTypes.VoiceSettings;
    }

    logger?.info?.('[11labs] convert start', { voiceId, modelId: convertOptions.modelId });

    try {
      const audioStream = await this.client.textToSpeech.convert(voiceId, convertOptions, {
        abortSignal: signal,
      });
      const buffer = await streamToBuffer(audioStream);

      logger?.info?.('[11labs] convert done', { bytes: buffer.length });

      const duration = await getAudioDuration(buffer, this.ctx.config.ffmpeg, logger, signal);
      logger?.info?.('[11labs] duration', { duration });

      return {
        audio: buffer,
        mimeType: 'audio/mpeg',
        duration,
        size: buffer.length,
      };
    } catch (error) {
      // Aborts are not failures. Propagate the native AbortError so consumers
      // can distinguish cancellation from a real generation failure (BullMQ
      // workers, retry logic, error counters, etc. all care about this).
      if (signal?.aborted || isAbortError(error)) {
        throw error;
      }
      const mapped = mapElevenLabsError(error);
      logger?.error?.('[11labs] generation error', {
        message: mapped.message,
        kind: mapped.name,
        statusCode: mapped.statusCode,
      });
      throw mapped;
    }
  }
}

/**
 * Detect a native AbortError. Covers both `DOMException` aborts (modern Node
 * fetch) and Node-style errors with `name === 'AbortError'` (execa, older
 * runtimes). Useful when we don't have access to the controlling signal but
 * still need to recognize cancellation in a catch block.
 */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/**
 * Convert an error thrown by the ElevenLabs SDK into one of the `@tts-conductor/core`
 * error classes, so consumers can apply uniform retry / classification logic without
 * parsing message strings.
 *
 * Mapping (HTTP status → class):
 * - 401 → `TtsAuthenticationError` (bad/missing API key)
 * - 403 → `TtsQuotaExceededError` (subscription tier exhausted — ElevenLabs uses 403, not 402, for this)
 * - 429 → `TtsRateLimitError` (with `retryAfterMs` parsed from the Retry-After header if present)
 * - 5xx → `TtsTransientError` (retry with backoff)
 * - 400, 422, other 4xx → `TtsInvalidInputError` (do not retry without changing input)
 * - `ElevenLabsError` with no `statusCode` → `TtsTransientError` (network failure, ambiguous shape)
 * - `ElevenLabsTimeoutError` → `TtsTransientError`
 * - Anything else → `TtsError` (base class; unclassified)
 */
function mapElevenLabsError(error: unknown): TtsError {
  if (error instanceof ElevenLabsTimeoutError) {
    return new TtsTransientError(`ElevenLabs request timed out: ${error.message}`, {
      cause: error,
    });
  }

  if (error instanceof ElevenLabsError) {
    const status = error.statusCode;
    const message = `ElevenLabs ${status ?? 'request'} failed: ${error.message}`;
    const opts = { cause: error, statusCode: status };

    if (status === undefined) {
      return new TtsTransientError(message, opts);
    }
    if (status === 401) return new TtsAuthenticationError(message, opts);
    if (status === 403) return new TtsQuotaExceededError(message, opts);
    if (status === 429) {
      return new TtsRateLimitError(message, {
        ...opts,
        retryAfterMs: extractRetryAfterMs(error),
      });
    }
    if (status >= 500) return new TtsTransientError(message, opts);
    if (status >= 400) return new TtsInvalidInputError(message, opts);
    return new TtsError(message, opts);
  }

  const message = error instanceof Error ? error.message : String(error);
  return new TtsError(`ElevenLabs generation failed: ${message}`, { cause: error });
}

/**
 * Parse a Retry-After header value into milliseconds. The header may be either a number
 * of seconds (e.g., `"30"`) or an HTTP date. Returns undefined if the header is absent,
 * unparseable, or the rawResponse is not available.
 */
function extractRetryAfterMs(error: ElevenLabsError): number | undefined {
  const headers = error.rawResponse?.headers;
  if (!headers) return undefined;

  const raw = readHeader(headers, 'retry-after');
  if (raw === undefined) return undefined;

  const seconds = Number.parseFloat(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const epochMs = Date.parse(raw);
  if (!Number.isNaN(epochMs)) {
    const diff = epochMs - Date.now();
    // Past or now: most likely server clock skew. Return undefined so callers
    // fall back to their own backoff policy rather than retrying immediately
    // (which could hammer a server that hasn't actually cooled down).
    return diff > 0 ? diff : undefined;
  }

  return undefined;
}

function readHeader(headers: unknown, name: string): string | undefined {
  // Headers can be a Fetch `Headers` instance or a plain record depending on SDK internals.
  if (headers && typeof (headers as Headers).get === 'function') {
    return (headers as Headers).get(name) ?? undefined;
  }
  if (headers && typeof headers === 'object') {
    const record = headers as Record<string, string | string[] | undefined>;
    const value = record[name] ?? record[name.toLowerCase()];
    if (Array.isArray(value)) return value[0];
    return value;
  }
  return undefined;
}

type ElevenLabsStream = ReadableStream<Uint8Array> | NodeJS.ReadableStream;

/**
 * Collect a streaming audio response into a single Buffer. Handles both
 * paths the SDK exposes — Web's `ReadableStream<Uint8Array>` and Node's
 * `Readable` — with defensive Buffer coercion at each chunk boundary.
 *
 * The `Buffer.from(chunk)` per-chunk wrap (web path) and the
 * `Buffer.isBuffer(data) ? data : Buffer.from(data)` (node path) guard
 * against SDK regressions or transports that surface chunks as
 * non-Buffer-typed ArrayBufferLikes. `Buffer.concat` requires
 * Uint8Array-compatible inputs; without the coercion, an exotic chunk
 * type would either throw at concat time or — worse — silently corrupt
 * the output.
 */
async function streamToBuffer(stream: ElevenLabsStream): Promise<Buffer> {
  if ('getReader' in stream && typeof stream.getReader === 'function') {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  }

  const nodeChunks: Buffer[] = [];
  const nodeStream = stream as NodeJS.ReadableStream;
  return new Promise<Buffer>((resolve, reject) => {
    nodeStream.on('data', (data) =>
      nodeChunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data)),
    );
    nodeStream.on('end', () => resolve(Buffer.concat(nodeChunks)));
    nodeStream.on('error', reject);
  });
}

export const elevenLabsProviderFactory: TtsProviderFactory<'11labs', ElevenLabsCallOverrides> = {
  id: '11labs',
  create(ctx: TtsProviderContext, options: ElevenLabsProviderOptions) {
    if (!options.apiKey) {
      throw new Error('ElevenLabs provider requires an apiKey');
    }
    if (!options.voiceId) {
      throw new Error('ElevenLabs provider requires a voiceId');
    }
    return new ElevenLabsProvider(ctx, options);
  },
};
