// src/config.ts
var ProcessStage = /* @__PURE__ */ ((ProcessStage2) => {
  ProcessStage2["Raw"] = "raw";
  ProcessStage2["Final"] = "final";
  ProcessStage2["Unknown"] = "unknown";
  return ProcessStage2;
})(ProcessStage || {});

// src/utils/chunker.ts
function splitByBoundaries(input, maxLen) {
  const chunks = [];
  let text = input;
  const hardMax = Math.max(1, maxLen);
  const isInsideTag = (str, pos) => {
    const lastLt = str.lastIndexOf("<", pos);
    const lastGt = str.lastIndexOf(">", pos);
    return lastLt > lastGt;
  };
  const adjustPosToAvoidTags = (str, pos) => {
    if (!isInsideTag(str, pos)) return pos;
    const lt = str.lastIndexOf("<", pos);
    let p = lt > 0 ? lt - 1 : pos;
    while (p > 0 && !/\s/.test(str.charAt(p))) p--;
    return Math.max(1, p);
  };
  while (text.length > hardMax) {
    const window = text.slice(0, hardMax);
    let splitPos = window.lastIndexOf("\n\n");
    if (splitPos < 0) splitPos = window.lastIndexOf("\n");
    if (splitPos < 0) {
      const sentenceRe = /[.!?](?=\s|$)/g;
      let lastEnd = -1;
      let m;
      while (m = sentenceRe.exec(window)) {
        lastEnd = m.index + 1;
      }
      if (lastEnd >= 0) splitPos = lastEnd;
    }
    if (splitPos < 0) splitPos = window.lastIndexOf(" ");
    if (splitPos < 0) splitPos = hardMax;
    splitPos = adjustPosToAvoidTags(window, splitPos);
    const head = text.slice(0, splitPos).trimEnd();
    chunks.push(head);
    text = text.slice(splitPos).trimStart();
  }
  if (text) chunks.push(text);
  return chunks;
}
function toChunks(segments, caps, logger) {
  const INLINE_LIMIT = caps.maxInlineBreakSeconds ?? 0;
  const renderInlineBreak = caps.renderInlineBreak ?? ((seconds) => `<break time="${seconds}s" />`);
  const MAX_CHARS = typeof caps.maxCharsPerRequest === "number" && isFinite(caps.maxCharsPerRequest) ? Math.max(1, caps.maxCharsPerRequest - 16) : void 0;
  const chunks = [];
  let buffer = "";
  let postPause = 0;
  const flush = () => {
    if (buffer) {
      chunks.push({ ssml: buffer.trim(), postPause });
      buffer = "";
      postPause = 0;
    }
  };
  for (const seg of segments) {
    if (seg.kind === "text") {
      const next = (buffer ? buffer + " " : "") + seg.value;
      if (MAX_CHARS && next.length > MAX_CHARS) {
        const parts = splitByBoundaries(next, MAX_CHARS);
        for (let i = 0; i < parts.length - 1; i++) {
          const part = (parts[i] ?? "").trim();
          if (part) {
            chunks.push({ ssml: part, postPause: 0 });
          }
        }
        const tail = parts.length > 0 ? parts[parts.length - 1] : "";
        buffer = tail ? tail : "";
        postPause = 0;
      } else {
        buffer = next;
      }
    } else {
      if (INLINE_LIMIT && seg.seconds <= INLINE_LIMIT) {
        const inlineBreak = renderInlineBreak(seg.seconds);
        buffer += ` ${inlineBreak}`;
      } else {
        postPause = seg.seconds;
        flush();
      }
    }
  }
  flush();
  logger?.debug?.("[tts] toChunks result", chunks);
  return chunks;
}

// src/utils/debug.ts
function buildMeta(options) {
  return {
    fileName: options.fileName ?? `tts_${Date.now()}.mp3`,
    jobId: options.jobId,
    stage: options.stage ?? "unknown" /* Unknown */
    // Provide default if not specified
  };
}
async function saveDebugFromBuffer(config, buffer, options = {}) {
  const sink = config.debug;
  if (!sink?.saveBuffer) return;
  const meta = buildMeta(options);
  await sink.saveBuffer(buffer, meta);
}
async function saveDebugFromFile(config, path3, options = {}) {
  const sink = config.debug;
  if (!sink?.saveFile) return;
  const meta = buildMeta(options);
  await sink.saveFile(path3, meta);
}

// src/utils/duration.ts
import { execa } from "execa";
import ffmpegPath from "ffmpeg-static";
import fs from "fs/promises";
import path from "path";
import { tmpdir } from "os";
async function resolveFfprobeBin(ffmpegConfig) {
  const candidates = [ffmpegConfig?.ffprobePath, process.env.FFPROBE_PATH, "ffprobe"].filter(
    Boolean
  );
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
    }
  }
  return candidates[candidates.length - 1] ?? "ffprobe";
}
async function resolveFfmpegBin(ffmpegConfig) {
  const candidates = [
    ffmpegConfig?.ffmpegPath,
    process.env.FFMPEG_PATH,
    process.env.FFMPEG_BIN
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
    }
  }
  if (ffmpegPath) {
    try {
      await fs.access(ffmpegPath);
      return ffmpegPath;
    } catch {
    }
  }
  return "ffmpeg";
}
async function getAudioDuration(audioBuffer, ffmpegConfig, logger) {
  const tempFile = path.join(tmpdir(), `tts_conductor_temp_${Date.now()}.mp3`);
  try {
    await fs.writeFile(tempFile, audioBuffer);
    const ffprobeBin = await resolveFfprobeBin(ffmpegConfig);
    const ffprobeResult = await execa(
      ffprobeBin,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        tempFile
      ],
      { reject: false }
    );
    const probeOut = ffprobeResult.stdout?.toString().trim() ?? "";
    const parsedProbe = parseFloat(probeOut);
    if (!Number.isNaN(parsedProbe) && parsedProbe > 0) {
      return Math.round(parsedProbe * 100) / 100;
    }
    const ffmpegBin = await resolveFfmpegBin(ffmpegConfig);
    const ffmpegResult = await execa(ffmpegBin, ["-i", tempFile], { reject: false });
    const stderr = ffmpegResult.stderr?.toString() ?? "";
    const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (match) {
      const hours = parseInt(match[1] ?? "0", 10);
      const minutes = parseInt(match[2] ?? "0", 10);
      const seconds = parseFloat(match[3] ?? "0");
      const total = hours * 3600 + minutes * 60 + seconds;
      return Math.round(total * 100) / 100;
    }
  } catch (error) {
    logger?.warn?.("Failed to read accurate audio duration, falling back to estimation", error);
  } finally {
    try {
      await fs.unlink(tempFile);
    } catch {
    }
  }
  return estimateAudioDuration(audioBuffer);
}
function estimateAudioDuration(audioBuffer, bitrate = 128) {
  return Math.round(audioBuffer.length * 8 / (bitrate * 1e3) * 100) / 100;
}

// src/utils/pause.ts
function lookup(table, label) {
  return table[label.toUpperCase()] ?? 0;
}
function parsePauseDuration(pauseMatch, table) {
  const content = pauseMatch.replace(/^\[PAUSE:/, "").replace(/\]$/, "");
  const numericMatch = content.match(/^(\d+(?:\.\d+)?)s?$/i);
  if (numericMatch) {
    return parseFloat(numericMatch[1] ?? "0");
  }
  const modifierMatch = content.match(/^([A-Z_]+):(\d+(?:\.\d+)?)([xs])$/i);
  if (modifierMatch) {
    const [, rawLabel, rawValue, suffix] = modifierMatch;
    const label = rawLabel?.toUpperCase() ?? "";
    const numValue = rawValue ? parseFloat(rawValue) : 0;
    const base = lookup(table, label);
    if (suffix?.toLowerCase() === "x") {
      return base * numValue;
    }
    if (suffix?.toLowerCase() === "s") {
      return numValue;
    }
  }
  const legacyMatch = content.match(/^(BREATH|FULL_BREATH|HALF_BREATH):(\d+)$/i);
  if (legacyMatch) {
    const [, rawLabel, rawMultiplier] = legacyMatch;
    const base = lookup(table, rawLabel?.toUpperCase() ?? "");
    return base * (rawMultiplier ? parseInt(rawMultiplier, 10) : 0);
  }
  return lookup(table, content.toUpperCase());
}
function isValidPauseFormat(input) {
  return /^\[PAUSE:([A-Z_]+(?::\d+(?:\.\d+)?[xs]?)?|\d+(?:\.\d+)?s?)\]$/i.test(input);
}
function extractPauseMarkers(text) {
  const matches = text.match(/\[PAUSE:([A-Z_]+(?::\d+(?:\.\d+)?[xs]?)?|\d+(?:\.\d+)?s?)\]/gi);
  return matches ?? [];
}

// src/utils/segmenter.ts
var PAUSE_RE = /\[PAUSE:([A-Z_]+(?::\d+(?:\.\d+)?[xs]?)?|\d+(?:\.\d+)?s?)\]/gi;
function parseScript(input, table, logger) {
  PAUSE_RE.lastIndex = 0;
  const segments = [];
  let lastIndex = 0;
  let match;
  while (match = PAUSE_RE.exec(input)) {
    if (match.index > lastIndex) {
      const textContent = input.slice(lastIndex, match.index).trim();
      if (textContent) {
        segments.push({ kind: "text", value: textContent });
      }
    }
    const fullMatch = match[0] ?? "";
    const label = match[1] ?? "";
    const seconds = parsePauseDuration(fullMatch, table);
    if (!label) {
      logger?.warn?.("Invalid pause format encountered", { fullMatch });
    } else {
      segments.push({ kind: "pause", label, seconds });
    }
    lastIndex = PAUSE_RE.lastIndex;
  }
  if (lastIndex < input.length) {
    const textContent = input.slice(lastIndex).trim();
    if (textContent) {
      segments.push({ kind: "text", value: textContent });
    }
  }
  for (let i = 1; i < segments.length - 1; i++) {
    const prev = segments[i - 1];
    const current = segments[i];
    const next = segments[i + 1];
    if (current.kind !== "pause" || prev.kind !== "text" || next.kind !== "text") continue;
    const dashTail = prev.value.match(/[-\u2013\u2014]\s*$/u);
    if (dashTail) {
      prev.value = prev.value.replace(/[-\u2013\u2014]\s*$/u, "").replace(/\s+$/u, "");
      const cleaned = next.value.replace(/^\s+/u, "");
      const dashChar = dashTail[0]?.trim() || "\u2014";
      next.value = `${dashChar} ${cleaned}`;
    }
    const punctuationMatch = next.value.match(/^(\s*)([.,!?:;…"')\]]+)/);
    if (punctuationMatch) {
      const punct = punctuationMatch[2] ?? "";
      if (punct) {
        prev.value = prev.value.replace(/\s+$/u, "") + punct;
        next.value = next.value.slice((punctuationMatch[0] ?? "").length).replace(/^\s+/u, "");
      }
    }
  }
  logger?.debug?.("[tts] parseScript output", segments);
  return segments;
}

// src/utils/stitcher.ts
import { execa as execa2 } from "execa";
import fs2 from "fs/promises";
import { tmpdir as tmpdir2 } from "os";
import path2 from "path";
var silenceCache = /* @__PURE__ */ new Map();
var MAX_SILENCE_CACHE_SIZE = 50;
async function resolveFfmpegBin2(ffmpegConfig) {
  const candidates = [
    ffmpegConfig?.ffmpegPath,
    process.env.FFMPEG_PATH,
    process.env.FFMPEG_BIN
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await fs2.access(candidate);
      return candidate;
    } catch {
    }
  }
  const ffmpegStatic = (await import("ffmpeg-static")).default;
  if (ffmpegStatic) {
    try {
      await fs2.access(ffmpegStatic);
      return ffmpegStatic;
    } catch {
    }
  }
  return "ffmpeg";
}
async function genSilenceWav(seconds, ffmpegConfig, logger) {
  if (silenceCache.has(seconds)) return silenceCache.get(seconds);
  const out = path2.join(tmpdir2(), `tts_conductor_silence_${seconds}.wav`);
  const ffmpegBin = await resolveFfmpegBin2(ffmpegConfig);
  try {
    await execa2(
      ffmpegBin,
      [
        "-f",
        "lavfi",
        "-i",
        `anullsrc=r=44100:cl=mono`,
        "-t",
        seconds.toString(),
        "-ac",
        "1",
        "-ar",
        "44100",
        "-c:a",
        "pcm_s16le",
        "-y",
        out
      ],
      { timeout: 3e4 }
    );
  } catch (error) {
    logger?.error?.("Failed to generate silence segment", { seconds, error });
    try {
      await fs2.unlink(out);
    } catch {
    }
    throw error;
  }
  if (silenceCache.size >= MAX_SILENCE_CACHE_SIZE) {
    const oldestKey = silenceCache.keys().next().value;
    if (typeof oldestKey === "number") {
      const oldestFile = silenceCache.get(oldestKey);
      silenceCache.delete(oldestKey);
      if (oldestFile) {
        fs2.unlink(oldestFile).catch(() => void 0);
      }
    }
  }
  silenceCache.set(seconds, out);
  return out;
}
async function concatParts(fileList, outPath, ffmpegConfig, logger) {
  const listFile = path2.join(tmpdir2(), `tts_conductor_concat_${Date.now()}.txt`);
  try {
    await fs2.writeFile(
      listFile,
      fileList.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n")
    );
    const ffmpegBin = await resolveFfmpegBin2(ffmpegConfig);
    try {
      await execa2(
        ffmpegBin,
        [
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          listFile,
          "-c:a",
          "pcm_s16le",
          "-ar",
          "44100",
          "-ac",
          "1",
          "-y",
          outPath
        ],
        { timeout: 45e3 }
      );
      return;
    } catch (error) {
      logger?.warn?.("Concat demuxer failed, attempting filter fallback", error);
      const args = [];
      for (const file of fileList) {
        args.push("-i", file);
      }
      const n = fileList.length;
      const filter = `${Array.from({ length: n }, (_, i) => `[${i}:a]`).join("")}concat=n=${n}:v=0:a=1, aformat=sample_fmts=s16:sample_rates=44100:channel_layouts=mono [a]`;
      args.push(
        "-filter_complex",
        filter,
        "-map",
        "[a]",
        "-c:a",
        "pcm_s16le",
        "-ar",
        "44100",
        "-ac",
        "1",
        "-y",
        outPath
      );
      await execa2(ffmpegBin, args, { timeout: 6e4 });
    }
  } finally {
    try {
      await fs2.unlink(listFile);
    } catch {
      logger?.debug?.("Failed to cleanup concat list file", { listFile });
    }
  }
}
async function buildFinalAudio(config, chunks, audio, fileName = `tts_${Date.now()}.mp3`, options) {
  if (chunks.length !== audio.length) {
    throw new Error("chunks and audio arrays must be equal length");
  }
  const logger = config.logger;
  const ffmpegConfig = config.ffmpeg;
  const tmp = tmpdir2();
  const partFiles = [];
  const tempFilesToCleanup = [];
  try {
    const ffmpegBin = await resolveFfmpegBin2(ffmpegConfig);
    for (let i = 0; i < audio.length; i++) {
      const speechMp3 = path2.join(tmp, `tts_chunk_${i}_${Date.now()}.mp3`);
      const speechWav = path2.join(tmp, `tts_chunk_${i}_${Date.now()}.wav`);
      await fs2.writeFile(speechMp3, audio[i]?.buffer ?? Buffer.alloc(0));
      tempFilesToCleanup.push(speechMp3);
      await execa2(
        ffmpegBin,
        ["-i", speechMp3, "-ar", "44100", "-ac", "1", "-c:a", "pcm_s16le", "-y", speechWav],
        { timeout: 3e4 }
      );
      partFiles.push(speechWav);
      tempFilesToCleanup.push(speechWav);
      const chunk = chunks[i];
      const pauseSeconds = chunk?.postPause ?? 0;
      if (pauseSeconds > 0) {
        const silenceFile = await genSilenceWav(pauseSeconds, ffmpegConfig, logger);
        partFiles.push(silenceFile);
      }
    }
    const outWavPath = path2.join(tmp, `tts_concat_${Date.now()}.wav`);
    tempFilesToCleanup.push(outWavPath);
    await concatParts(partFiles, outWavPath, ffmpegConfig, logger);
    const outPath = path2.join(tmp, fileName);
    tempFilesToCleanup.push(outPath);
    await execa2(
      ffmpegBin,
      ["-i", outWavPath, "-c:a", "libmp3lame", "-ar", "44100", "-b:a", "192k", "-y", outPath],
      { timeout: 45e3 }
    );
    await saveDebugFromFile(config, outPath, {
      fileName: `final_${fileName}`,
      jobId: options?.debugJobId,
      stage: "final" /* Final */
    });
    const buf = await fs2.readFile(outPath);
    const durationSec = audio.reduce((sum, part, idx) => {
      const chunk = chunks[idx];
      const pause = chunk?.postPause ?? 0;
      return sum + part.duration + pause;
    }, 0);
    const result = {
      base64Data: buf.toString("base64"),
      mimeType: "audio/mpeg",
      size: buf.length,
      duration: durationSec
    };
    await cleanupTempFiles(tempFilesToCleanup);
    return result;
  } catch (error) {
    await cleanupTempFiles(tempFilesToCleanup);
    throw error;
  }
}
async function cleanupTempFiles(filePaths) {
  await Promise.allSettled(
    filePaths.map(async (filePath) => {
      try {
        await fs2.unlink(filePath);
      } catch {
      }
    })
  );
}

// src/operations.ts
function withTimeout(promise, ms, label) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`[tts] Timeout after ${ms}ms during ${label}`));
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}
async function ttsGenerateFull(rawText, provider, config, onProgress, options) {
  const logger = config.logger;
  const providerId = provider.id;
  const segments = parseScript(rawText, config.pauses, logger);
  logger?.info?.("[tts] Parsed segments", { count: segments.length });
  const chunks = toChunks(segments, provider.caps, logger);
  logger?.info?.("[tts] Generated chunks", { count: chunks.length });
  const audioParts = [];
  let done = 0;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const input = `<speak>${chunk.ssml}</speak>`;
    logger?.debug?.("[tts] Generating chunk", {
      provider: providerId,
      index: i,
      postPause: chunk.postPause
    });
    onProgress?.(Math.min(10, Math.round((i + 1) / chunks.length * 10)));
    const res = await withTimeout(provider.generate(input), 6e4, `provider.generate chunk ${i}`);
    const duration = res.duration ?? await getAudioDuration(res.audio, config.ffmpeg, logger);
    audioParts.push({ buffer: res.audio, duration });
    done++;
    await saveDebugFromBuffer(config, res.audio, {
      fileName: `raw_${providerId}_${i}_${Date.now()}.mp3`,
      jobId: options?.debugJobId,
      stage: "raw" /* Raw */
    });
    const chunkProgress = Math.round(done / chunks.length * 80);
    onProgress?.(chunkProgress);
  }
  onProgress?.(80);
  const final = await withTimeout(
    buildFinalAudio(config, chunks, audioParts, void 0, options),
    45e3,
    "stitcher.buildFinalAudio"
  );
  onProgress?.(100);
  return final;
}

// src/conductor.ts
var TtsConductor = class {
  constructor(config) {
    this.config = config;
    this.providers = /* @__PURE__ */ new Map();
  }
  get runtimeConfig() {
    return this.config;
  }
  /**
   * Register a provider factory with type-safe options.
   * Provider must be registered in the TtsProviderRegistry via module augmentation.
   */
  registerProvider(factory) {
    this.providers.set(factory.id, {
      id: factory.id,
      create: factory.create
    });
    this.config.logger?.debug?.("Registered provider", factory.id);
    return factory.id;
  }
  hasProvider(id) {
    return this.providers.has(id);
  }
  listProviders() {
    return Array.from(this.providers.keys());
  }
  /**
   * Create a provider instance with type-safe options.
   * Provider must be registered in the TtsProviderRegistry via module augmentation.
   */
  createProvider(id, options) {
    const factory = this.providers.get(id);
    if (!factory) {
      throw new Error(`Provider '${id}' is not registered`);
    }
    this.config.logger?.info?.("Creating provider instance", id, { options });
    return factory.create({ config: this.config, id: factory.id }, options);
  }
  async generateFull(rawText, provider, onProgress, options) {
    return ttsGenerateFull(rawText, provider, this.config, onProgress, options);
  }
};
function createTtsConductor(config) {
  return new TtsConductor(config);
}

// src/defaults.ts
var DEFAULT_PAUSE_TABLE = {
  MICRO: 0.5,
  SHORT: 1.5,
  MEDIUM: 3.5,
  LONG: 8,
  FULL_BREATH: 5,
  HALF_BREATH: 3,
  SETTLE: 10,
  BREATH: 5
};
export {
  DEFAULT_PAUSE_TABLE,
  ProcessStage,
  TtsConductor,
  buildFinalAudio,
  createTtsConductor,
  estimateAudioDuration,
  extractPauseMarkers,
  getAudioDuration,
  isValidPauseFormat,
  parsePauseDuration,
  parseScript,
  toChunks,
  ttsGenerateFull,
  withTimeout
};
//# sourceMappingURL=index.js.map