import type { ElevenLabs as ElevenLabsTypes } from '@elevenlabs/elevenlabs-js';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import type {
  GenerationResult,
  ProviderCapabilities,
  TtsProvider,
  TtsProviderContext,
  TtsProviderFactory,
} from '@tts-conductor/core';
import { getAudioDuration } from '@tts-conductor/core';

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
  renderInlineBreak: (seconds) => `<break time="${seconds}s" />`,
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

    const convertOptions: ElevenLabsTypes.TextToSpeechRequest = {
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
      const message = error instanceof Error ? error.message : String(error);
      logger?.error?.('[11labs] generation error', { message });
      throw new Error(`ElevenLabs generation failed: ${message}`);
    }
  }
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
