import type { ElevenLabs as ElevenLabsTypes } from '@elevenlabs/elevenlabs-js';
import {
  ElevenLabsClient,
  ElevenLabsError,
  ElevenLabsTimeoutError,
} from '@elevenlabs/elevenlabs-js';
import type {
  GenerationResult,
  ProviderCapabilities,
  TtsProvider,
  TtsProviderContext,
  TtsProviderFactory,
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

export interface ElevenLabsVoiceSettings {
  stability?: number | null;
  use_speaker_boost?: boolean | null;
  similarity_boost?: number | null;
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

// Register the ElevenLabs provider in the type registry
declare module '@tts-conductor/core' {
  interface TtsProviderRegistry {
    '11labs': ElevenLabsProviderOptions;
  }
}

const CAPS: ProviderCapabilities = {
  maxInlineBreakSeconds: 3,
  maxCharsPerRequest: 1200,
  renderInlineBreak: (seconds: number) => `<break time="${seconds}s" />`,
};

class ElevenLabsProvider implements TtsProvider {
  readonly id: string;
  readonly caps = CAPS;
  private client: ElevenLabsClient;

  constructor(
    private readonly ctx: TtsProviderContext,
    private readonly options: ElevenLabsProviderOptions,
  ) {
    this.id = ctx.id;
    this.client = new ElevenLabsClient({ apiKey: options.apiKey });
  }

  async generate(chunk: string): Promise<GenerationResult> {
    const { voiceId, quality = 'standard', voiceSettings } = this.options;
    const logger = this.ctx.config.logger;

    const modelMap: Record<ElevenLabsQuality, string> = {
      draft: 'eleven_turbo_v2_5',
      standard: 'eleven_multilingual_v2',
      high: 'eleven_multilingual_v2',
    };

    const convertOptions: ElevenLabsTypes.BodyTextToSpeechFull = {
      text: chunk,
      outputFormat: 'mp3_44100_128',
      modelId: modelMap[quality] ?? modelMap.standard,
    };

    if (voiceSettings) {
      convertOptions.voiceSettings = voiceSettings as ElevenLabsTypes.VoiceSettings;
    }

    logger?.info?.('[11labs] convert start', { voiceId, modelId: convertOptions.modelId });

    try {
      const audioStream = await this.client.textToSpeech.convert(voiceId, convertOptions);
      const buffer = await streamToBuffer(audioStream);

      logger?.info?.('[11labs] convert done', { bytes: buffer.length });

      const duration = await getAudioDuration(buffer, this.ctx.config.ffmpeg, logger);
      logger?.info?.('[11labs] duration', { duration });

      return {
        audio: buffer,
        mimeType: 'audio/mpeg',
        duration,
        size: buffer.length,
      };
    } catch (error) {
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

export const elevenLabsProviderFactory: TtsProviderFactory<'11labs'> = {
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
