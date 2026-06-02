import type {
  GenerateCallOptions,
  GenerationResult,
  ProviderCapabilities,
  TtsProvider,
  TtsProviderContext,
  TtsProviderFactory,
  VoiceCatalog,
} from '@alien-lobster-buffet/tts-conductor-core';
import { TtsError } from '@alien-lobster-buffet/tts-conductor-core';
import { createFalClient, type FalClient } from '@fal-ai/client';
import { FAL_DESCRIPTORS } from './descriptors';
import type { CanonicalTtsInput, FalModelDescriptor, FalModelId, FalVoiceSelection } from './types';

/**
 * Construction options for the single `fal` provider id. `model` selects the
 * engine (the marketplace lives here, at construction); the returned provider
 * instance is bound to that one model. `voice` / `params` are per-instance
 * defaults that per-call overrides can replace.
 */
export interface FalProviderOptions {
  apiKey: string;
  model: FalModelId;
  voice?: FalVoiceSelection;
  params?: Record<string, unknown>;
}

/** Per-call overrides — vary the voice or scalar params for a single `generate`. */
export interface FalCallOverrides {
  voice?: FalVoiceSelection;
  params?: Record<string, unknown>;
}

declare module '@alien-lobster-buffet/tts-conductor-core' {
  interface TtsProviderRegistry {
    fal: FalProviderOptions;
  }
  interface TtsProviderCallOverridesRegistry {
    fal: FalCallOverrides;
  }
}

/**
 * Remove core's `<speak>…</speak>` wrapper, which the orchestrator adds to every
 * chunk. fal engines take plain text/prompt, not SSML (and the descriptors
 * declare `maxInlineBreakSeconds: null`, so the chunker emits no `<break>` tags).
 */
function stripSpeak(input: string): string {
  return input
    .replace(/^\s*<speak[^>]*>/i, '')
    .replace(/<\/speak>\s*$/i, '')
    .trim();
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

class FalProvider implements TtsProvider<FalCallOverrides> {
  readonly id: string;
  readonly caps: ProviderCapabilities;
  readonly voiceCatalog?: VoiceCatalog;
  private readonly descriptor: FalModelDescriptor;

  constructor(
    private readonly ctx: TtsProviderContext,
    private readonly options: FalProviderOptions,
    // Instance-local fal client — credentials are scoped to this provider, not
    // a global singleton, so multiple providers with different keys don't race.
    private readonly client: FalClient,
  ) {
    this.id = ctx.id;
    this.descriptor = FAL_DESCRIPTORS[options.model];
    this.caps = this.descriptor.caps;
    this.voiceCatalog = this.descriptor.voiceCatalog;
  }

  async generate(
    chunk: string,
    options?: GenerateCallOptions<FalCallOverrides>,
  ): Promise<GenerationResult> {
    const signal = options?.signal;
    signal?.throwIfAborted();

    const overrides = options?.overrides;
    const mergedParams =
      this.options.params || overrides?.params
        ? { ...this.options.params, ...overrides?.params }
        : undefined;
    const canonical: CanonicalTtsInput = {
      text: stripSpeak(chunk),
      voice: overrides?.voice ?? this.options.voice,
      params: mergedParams,
    };

    const input = this.descriptor.buildInput(canonical);
    const logger = this.ctx.config.logger;
    logger?.info?.('[fal] subscribe start', { model: this.options.model });

    try {
      const result = await this.client.subscribe(this.descriptor.endpointId, {
        input,
        ...(signal ? { abortSignal: signal } : {}),
      });

      const { url, mimeType } = this.descriptor.extractAudio(result.data);
      const audio = await this.fetchAudio(url, signal);
      const duration = this.descriptor.extractDuration?.(result.data);

      logger?.info?.('[fal] generation done', {
        model: this.options.model,
        bytes: audio.length,
        requestId: result.requestId,
      });

      return {
        audio,
        mimeType,
        ...(duration !== undefined ? { duration } : {}),
        size: audio.length,
        // Opaque per-chunk metadata for core; consumers reconcile fal cost from
        // the aggregated request_ids on the final result.
        providerMeta: { request_id: result.requestId },
      };
    } catch (error) {
      // Aborts are not failures — propagate so consumers can distinguish
      // cancellation from a real error (BullMQ workers, retry logic, etc.).
      if (isAbortError(error)) throw error;
      // If the call was cancelled, surface a clean AbortError rather than
      // re-throwing whatever the SDK happened to raise after the abort — that
      // would otherwise mislabel a real API error as a cancellation.
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      // A TtsError raised below (e.g. a failed fetch) is already classified.
      if (error instanceof TtsError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const mapped = new TtsError(`fal generation failed: ${message}`, { cause: error });
      logger?.error?.('[fal] generation error', { message: mapped.message });
      throw mapped;
    }
  }

  /** Shared, abort-aware fetch turning a model's `audio.url` into bytes. */
  private async fetchAudio(url: string, signal?: AbortSignal): Promise<Buffer> {
    const res = await fetch(url, signal ? { signal } : {});
    if (!res.ok) {
      throw new TtsError(`fal audio fetch failed (${res.status}): ${url}`, {
        statusCode: res.status,
      });
    }
    return Buffer.from(await res.arrayBuffer());
  }
}

export const falProviderFactory: TtsProviderFactory<'fal', FalCallOverrides> = {
  id: 'fal',
  create(ctx: TtsProviderContext, options: FalProviderOptions) {
    if (!options.apiKey) {
      throw new Error('fal provider requires an apiKey');
    }
    if (!options.model || !FAL_DESCRIPTORS[options.model]) {
      throw new Error(`fal provider: unknown model "${options.model}"`);
    }
    // Instance-local client — credentials scoped here, no global mutation.
    const client = createFalClient({ credentials: options.apiKey });
    return new FalProvider(ctx, options, client);
  },
};
