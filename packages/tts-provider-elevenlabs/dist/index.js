// src/elevenLabsProvider.ts
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { getAudioDuration } from "@tts-conductor/core";
var CAPS = {
  maxInlineBreakSeconds: 3,
  maxCharsPerRequest: 1200,
  renderInlineBreak: (seconds) => `<break time="${seconds}s" />`
};
var ElevenLabsProvider = class {
  constructor(ctx, options) {
    this.ctx = ctx;
    this.options = options;
    this.caps = CAPS;
    this.client = new ElevenLabsClient({ apiKey: options.apiKey });
  }
  async generate(chunk) {
    const { voiceId, quality = "standard", voiceSettings } = this.options;
    const logger = this.ctx.config.logger;
    const modelMap = {
      draft: "eleven_turbo_v2_5",
      standard: "eleven_multilingual_v2",
      high: "eleven_multilingual_v2"
    };
    const convertOptions = {
      text: chunk,
      outputFormat: "mp3_44100_128",
      modelId: modelMap[quality] ?? modelMap.standard
    };
    if (voiceSettings) {
      convertOptions.voiceSettings = voiceSettings;
    }
    logger?.info?.("[11labs] convert start", { voiceId, modelId: convertOptions.modelId });
    try {
      const audioStream = await this.client.textToSpeech.convert(voiceId, convertOptions);
      const buffer = await streamToBuffer(audioStream);
      logger?.info?.("[11labs] convert done", { bytes: buffer.length });
      const duration = await getAudioDuration(buffer, this.ctx.config.ffmpeg, logger);
      logger?.info?.("[11labs] duration", { duration });
      return {
        audio: buffer,
        mimeType: "audio/mpeg",
        duration,
        size: buffer.length
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.error?.("[11labs] generation error", { message });
      throw new Error(`ElevenLabs generation failed: ${message}`);
    }
  }
};
async function streamToBuffer(stream) {
  if ("getReader" in stream && typeof stream.getReader === "function") {
    const reader = stream.getReader();
    const chunks = [];
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
  const nodeChunks = [];
  const nodeStream = stream;
  return new Promise((resolve, reject) => {
    nodeStream.on(
      "data",
      (data) => nodeChunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data))
    );
    nodeStream.on("end", () => resolve(Buffer.concat(nodeChunks)));
    nodeStream.on("error", reject);
  });
}
var elevenLabsProviderFactory = {
  id: "11labs",
  create(ctx, options) {
    if (!options.apiKey) {
      throw new Error("ElevenLabs provider requires an apiKey");
    }
    if (!options.voiceId) {
      throw new Error("ElevenLabs provider requires a voiceId");
    }
    return new ElevenLabsProvider(ctx, options);
  }
};
export {
  elevenLabsProviderFactory
};
//# sourceMappingURL=index.js.map