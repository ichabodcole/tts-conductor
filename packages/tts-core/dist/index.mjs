import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execa } from "execa";
import ffmpegPath from "ffmpeg-static";
//#region src/config.ts
let ProcessStage = /* @__PURE__ */ function(ProcessStage) {
	/** Individual audio chunks from providers */
	ProcessStage["Raw"] = "raw";
	/** Final assembled audio after stitching */
	ProcessStage["Final"] = "final";
	/** Fallback stage when not specified by caller */
	ProcessStage["Unknown"] = "unknown";
	return ProcessStage;
}({});
//#endregion
//#region src/errors.ts
/**
* Error hierarchy for TTS provider failures. Adapters convert SDK-specific errors
* to these classes so consumers can apply uniform retry / classification logic
* without parsing error messages.
*
* Consumers should use `instanceof` checks rather than string matching:
*
* ```ts
* try {
*   await provider.generate(chunk);
* } catch (err) {
*   if (err instanceof TtsRateLimitError) {
*     await sleep(err.retryAfterMs ?? 1000);
*     // retry
*   } else if (err instanceof TtsTransientError) {
*     // exponential backoff
*   } else if (err instanceof TtsInvalidInputError) {
*     // do not retry; surface to caller
*   }
* }
* ```
*/
/** Base class for all TTS provider errors. Direct instances signal an unclassified failure. */
var TtsError = class extends Error {
	constructor(message, options) {
		super(message);
		this.name = "TtsError";
		this.cause = options?.cause;
		this.statusCode = options?.statusCode;
	}
};
/**
* Provider rejected the request because the caller has exceeded a rate limit.
* Retry after `retryAfterMs` if supplied, otherwise apply caller-default backoff.
*/
var TtsRateLimitError = class extends TtsError {
	constructor(message, options) {
		super(message, options);
		this.name = "TtsRateLimitError";
		this.retryAfterMs = options?.retryAfterMs;
	}
};
/**
* Provider rejected the request because the caller has exhausted their quota or
* subscription tier. Retrying without consumer action (upgrade, top-up) will keep failing.
*/
var TtsQuotaExceededError = class extends TtsError {
	constructor(message, options) {
		super(message, options);
		this.name = "TtsQuotaExceededError";
	}
};
/**
* Provider rejected the credentials. The API key is missing, invalid, or revoked.
* Retrying will not help until the caller fixes their authentication.
*/
var TtsAuthenticationError = class extends TtsError {
	constructor(message, options) {
		super(message, options);
		this.name = "TtsAuthenticationError";
	}
};
/**
* Provider failure that is expected to resolve on retry: 5xx responses, network errors,
* upstream timeouts, transient connectivity issues. Safe to retry with exponential backoff.
*/
var TtsTransientError = class extends TtsError {
	constructor(message, options) {
		super(message, options);
		this.name = "TtsTransientError";
	}
};
/**
* Provider rejected the request because the input was malformed or unprocessable.
* Retrying with the same input will not help; the caller must fix the input.
*/
var TtsInvalidInputError = class extends TtsError {
	constructor(message, options) {
		super(message, options);
		this.name = "TtsInvalidInputError";
	}
};
//#endregion
//#region src/utils/chunker.ts
function splitByBoundaries(input, maxLen) {
	const chunks = [];
	let text = input;
	const hardMax = Math.max(1, maxLen);
	const isInsideTag = (str, pos) => {
		return str.lastIndexOf("<", pos) > str.lastIndexOf(">", pos);
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
			for (const m of window.matchAll(sentenceRe)) lastEnd = (m.index ?? 0) + 1;
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
	const MAX_CHARS = typeof caps.maxCharsPerRequest === "number" && Number.isFinite(caps.maxCharsPerRequest) ? Math.max(1, caps.maxCharsPerRequest - 16) : void 0;
	const chunks = [];
	let buffer = "";
	let postPause = 0;
	const flush = () => {
		if (buffer) {
			chunks.push({
				ssml: buffer.trim(),
				postPause
			});
			buffer = "";
			postPause = 0;
		}
	};
	for (const seg of segments) if (seg.kind === "text") {
		const next = (buffer ? `${buffer} ` : "") + seg.value;
		if (MAX_CHARS && next.length > MAX_CHARS) {
			const parts = splitByBoundaries(next, MAX_CHARS);
			for (let i = 0; i < parts.length - 1; i++) {
				const part = (parts[i] ?? "").trim();
				if (part) chunks.push({
					ssml: part,
					postPause: 0
				});
			}
			const tail = parts.length > 0 ? parts[parts.length - 1] : "";
			buffer = tail ? tail : "";
			postPause = 0;
		} else buffer = next;
	} else if (INLINE_LIMIT && seg.seconds <= INLINE_LIMIT) {
		const inlineBreak = renderInlineBreak(seg.seconds);
		buffer += ` ${inlineBreak}`;
	} else {
		postPause = seg.seconds;
		flush();
	}
	flush();
	logger?.debug?.("[tts] toChunks result", chunks);
	return chunks;
}
//#endregion
//#region src/utils/debug.ts
function buildMeta(options) {
	return {
		fileName: options.fileName ?? `tts_${Date.now()}.mp3`,
		jobId: options.jobId,
		stage: options.stage ?? "unknown"
	};
}
async function saveDebugFromBuffer(config, buffer, options = {}) {
	const sink = config.debug;
	if (!sink?.saveBuffer) return;
	const meta = buildMeta(options);
	await sink.saveBuffer(buffer, meta);
}
async function saveDebugFromFile(config, path, options = {}) {
	const sink = config.debug;
	if (!sink?.saveFile) return;
	const meta = buildMeta(options);
	await sink.saveFile(path, meta);
}
//#endregion
//#region src/utils/duration.ts
async function resolveFfprobeBin(ffmpegConfig) {
	const candidates = [
		ffmpegConfig?.ffprobePath,
		process.env.FFPROBE_PATH,
		"ffprobe"
	].filter(Boolean);
	for (const candidate of candidates) try {
		await fs.access(candidate);
		return candidate;
	} catch {}
	return candidates[candidates.length - 1] ?? "ffprobe";
}
async function resolveFfmpegBin$1(ffmpegConfig) {
	const candidates = [
		ffmpegConfig?.ffmpegPath,
		process.env.FFMPEG_PATH,
		process.env.FFMPEG_BIN
	].filter(Boolean);
	for (const candidate of candidates) try {
		await fs.access(candidate);
		return candidate;
	} catch {}
	if (ffmpegPath) try {
		await fs.access(ffmpegPath);
		return ffmpegPath;
	} catch {}
	return "ffmpeg";
}
async function getAudioDuration(audioBuffer, ffmpegConfig, logger) {
	const tempFile = path.join(tmpdir(), `tts_conductor_temp_${Date.now()}.mp3`);
	try {
		await fs.writeFile(tempFile, audioBuffer);
		const probeOut = (await execa(await resolveFfprobeBin(ffmpegConfig), [
			"-v",
			"error",
			"-show_entries",
			"format=duration",
			"-of",
			"default=noprint_wrappers=1:nokey=1",
			tempFile
		], { reject: false })).stdout?.toString().trim() ?? "";
		const parsedProbe = parseFloat(probeOut);
		if (!Number.isNaN(parsedProbe) && parsedProbe > 0) return Math.round(parsedProbe * 100) / 100;
		const match = ((await execa(await resolveFfmpegBin$1(ffmpegConfig), ["-i", tempFile], { reject: false })).stderr?.toString() ?? "").match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
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
		} catch {}
	}
	return estimateAudioDuration(audioBuffer);
}
function estimateAudioDuration(audioBuffer, bitrate = 128) {
	return Math.round(audioBuffer.length * 8 / (bitrate * 1e3) * 100) / 100;
}
//#endregion
//#region src/utils/pause.ts
function lookup(table, label) {
	return table[label.toUpperCase()] ?? 0;
}
/**
* Parse pause duration from various pause formats
* Supports patterns like:
*   [PAUSE:LABEL]
*   [PAUSE:LABEL:Nx]
*   [PAUSE:LABEL:Ns]
*   [PAUSE:Ns]
*/
function parsePauseDuration(pauseMatch, table) {
	const content = pauseMatch.replace(/^\[PAUSE:/, "").replace(/\]$/, "");
	const numericMatch = content.match(/^(\d+(?:\.\d+)?)s?$/i);
	if (numericMatch) return parseFloat(numericMatch[1] ?? "0");
	const modifierMatch = content.match(/^([A-Z_]+):(\d+(?:\.\d+)?)([xs])$/i);
	if (modifierMatch) {
		const [, rawLabel, rawValue, suffix] = modifierMatch;
		const label = rawLabel?.toUpperCase() ?? "";
		const numValue = rawValue ? parseFloat(rawValue) : 0;
		const base = lookup(table, label);
		if (suffix?.toLowerCase() === "x") return base * numValue;
		if (suffix?.toLowerCase() === "s") return numValue;
	}
	const legacyMatch = content.match(/^(BREATH|FULL_BREATH|HALF_BREATH):(\d+)$/i);
	if (legacyMatch) {
		const [, rawLabel, rawMultiplier] = legacyMatch;
		return lookup(table, rawLabel?.toUpperCase() ?? "") * (rawMultiplier ? parseInt(rawMultiplier, 10) : 0);
	}
	return lookup(table, content.toUpperCase());
}
function isValidPauseFormat(input) {
	return /^\[PAUSE:([A-Z_]+(?::\d+(?:\.\d+)?[xs]?)?|\d+(?:\.\d+)?s?)\]$/i.test(input);
}
function extractPauseMarkers(text) {
	return text.match(/\[PAUSE:([A-Z_]+(?::\d+(?:\.\d+)?[xs]?)?|\d+(?:\.\d+)?s?)\]/gi) ?? [];
}
//#endregion
//#region src/utils/segmenter.ts
const PAUSE_RE = /\[PAUSE:([A-Z_]+(?::\d+(?:\.\d+)?[xs]?)?|\d+(?:\.\d+)?s?)\]/gi;
function parseScript(input, table, logger) {
	const segments = [];
	let lastIndex = 0;
	for (const match of input.matchAll(PAUSE_RE)) {
		const matchIndex = match.index ?? 0;
		if (matchIndex > lastIndex) {
			const textContent = input.slice(lastIndex, matchIndex).trim();
			if (textContent) segments.push({
				kind: "text",
				value: textContent
			});
		}
		const fullMatch = match[0] ?? "";
		const label = match[1] ?? "";
		const seconds = parsePauseDuration(fullMatch, table);
		if (!label) logger?.warn?.("Invalid pause format encountered", { fullMatch });
		else segments.push({
			kind: "pause",
			label,
			seconds
		});
		lastIndex = matchIndex + fullMatch.length;
	}
	if (lastIndex < input.length) {
		const textContent = input.slice(lastIndex).trim();
		if (textContent) segments.push({
			kind: "text",
			value: textContent
		});
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
			next.value = `${dashTail[0]?.trim() || "—"} ${cleaned}`;
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
//#endregion
//#region src/utils/stitcher.ts
const silenceCache = /* @__PURE__ */ new Map();
const MAX_SILENCE_CACHE_SIZE = 50;
async function resolveFfmpegBin(ffmpegConfig) {
	const candidates = [
		ffmpegConfig?.ffmpegPath,
		process.env.FFMPEG_PATH,
		process.env.FFMPEG_BIN
	].filter(Boolean);
	for (const candidate of candidates) try {
		await fs.access(candidate);
		return candidate;
	} catch {}
	const ffmpegStatic = (await import("ffmpeg-static")).default;
	if (ffmpegStatic) try {
		await fs.access(ffmpegStatic);
		return ffmpegStatic;
	} catch {}
	return "ffmpeg";
}
async function genSilenceWav(seconds, ffmpegConfig, logger) {
	if (silenceCache.has(seconds)) return silenceCache.get(seconds);
	const out = path.join(tmpdir(), `tts_conductor_silence_${seconds}.wav`);
	const ffmpegBin = await resolveFfmpegBin(ffmpegConfig);
	try {
		await execa(ffmpegBin, [
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
		], { timeout: 3e4 });
	} catch (error) {
		logger?.error?.("Failed to generate silence segment", {
			seconds,
			error
		});
		try {
			await fs.unlink(out);
		} catch {}
		throw error;
	}
	if (silenceCache.size >= MAX_SILENCE_CACHE_SIZE) {
		const oldestKey = silenceCache.keys().next().value;
		if (typeof oldestKey === "number") {
			const oldestFile = silenceCache.get(oldestKey);
			silenceCache.delete(oldestKey);
			if (oldestFile) fs.unlink(oldestFile).catch(() => void 0);
		}
	}
	silenceCache.set(seconds, out);
	return out;
}
async function concatParts(fileList, outPath, ffmpegConfig, logger) {
	const listFile = path.join(tmpdir(), `tts_conductor_concat_${Date.now()}.txt`);
	try {
		await fs.writeFile(listFile, fileList.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
		const ffmpegBin = await resolveFfmpegBin(ffmpegConfig);
		try {
			await execa(ffmpegBin, [
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
			], { timeout: 45e3 });
			return;
		} catch (error) {
			logger?.warn?.("Concat demuxer failed, attempting filter fallback", error);
			const args = [];
			for (const file of fileList) args.push("-i", file);
			const n = fileList.length;
			const filter = `${Array.from({ length: n }, (_, i) => `[${i}:a]`).join("")}concat=n=${n}:v=0:a=1, aformat=sample_fmts=s16:sample_rates=44100:channel_layouts=mono [a]`;
			args.push("-filter_complex", filter, "-map", "[a]", "-c:a", "pcm_s16le", "-ar", "44100", "-ac", "1", "-y", outPath);
			await execa(ffmpegBin, args, { timeout: 6e4 });
		}
	} finally {
		try {
			await fs.unlink(listFile);
		} catch {
			logger?.debug?.("Failed to cleanup concat list file", { listFile });
		}
	}
}
async function buildFinalAudio(config, chunks, audio, fileName = `tts_${Date.now()}.mp3`, options) {
	if (chunks.length !== audio.length) throw new Error("chunks and audio arrays must be equal length");
	const logger = config.logger;
	const ffmpegConfig = config.ffmpeg;
	const tmp = tmpdir();
	const partFiles = [];
	const tempFilesToCleanup = [];
	try {
		const ffmpegBin = await resolveFfmpegBin(ffmpegConfig);
		for (let i = 0; i < audio.length; i++) {
			const speechMp3 = path.join(tmp, `tts_chunk_${i}_${Date.now()}.mp3`);
			const speechWav = path.join(tmp, `tts_chunk_${i}_${Date.now()}.wav`);
			await fs.writeFile(speechMp3, audio[i]?.buffer ?? Buffer.alloc(0));
			tempFilesToCleanup.push(speechMp3);
			await execa(ffmpegBin, [
				"-i",
				speechMp3,
				"-ar",
				"44100",
				"-ac",
				"1",
				"-c:a",
				"pcm_s16le",
				"-y",
				speechWav
			], { timeout: 3e4 });
			partFiles.push(speechWav);
			tempFilesToCleanup.push(speechWav);
			const pauseSeconds = chunks[i]?.postPause ?? 0;
			if (pauseSeconds > 0) {
				const silenceFile = await genSilenceWav(pauseSeconds, ffmpegConfig, logger);
				partFiles.push(silenceFile);
			}
		}
		const outWavPath = path.join(tmp, `tts_concat_${Date.now()}.wav`);
		tempFilesToCleanup.push(outWavPath);
		await concatParts(partFiles, outWavPath, ffmpegConfig, logger);
		const outPath = path.join(tmp, fileName);
		tempFilesToCleanup.push(outPath);
		await execa(ffmpegBin, [
			"-i",
			outWavPath,
			"-c:a",
			"libmp3lame",
			"-ar",
			"44100",
			"-b:a",
			"192k",
			"-y",
			outPath
		], { timeout: 45e3 });
		await saveDebugFromFile(config, outPath, {
			fileName: `final_${fileName}`,
			jobId: options?.debugJobId,
			stage: "final"
		});
		const buf = await fs.readFile(outPath);
		const durationSec = audio.reduce((sum, part, idx) => {
			const pause = chunks[idx]?.postPause ?? 0;
			return sum + part.duration + pause;
		}, 0);
		const result = {
			audio: buf,
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
	await Promise.allSettled(filePaths.map(async (filePath) => {
		try {
			await fs.unlink(filePath);
		} catch {}
	}));
}
//#endregion
//#region src/operations.ts
function withTimeout(promise, ms, label) {
	let timer;
	const timeoutPromise = new Promise((_, reject) => {
		timer = setTimeout(() => {
			reject(new TtsTransientError(`[tts] Timeout after ${ms}ms during ${label}`));
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
		audioParts.push({
			buffer: res.audio,
			duration
		});
		done++;
		await saveDebugFromBuffer(config, res.audio, {
			fileName: `raw_${providerId}_${i}_${Date.now()}.mp3`,
			jobId: options?.debugJobId,
			stage: "raw"
		});
		const chunkProgress = Math.round(done / chunks.length * 80);
		onProgress?.(chunkProgress);
	}
	onProgress?.(80);
	const final = await withTimeout(buildFinalAudio(config, chunks, audioParts, void 0, options), 45e3, "stitcher.buildFinalAudio");
	onProgress?.(100);
	return final;
}
//#endregion
//#region src/conductor.ts
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
		if (!factory) throw new Error(`Provider '${id}' is not registered`);
		this.config.logger?.info?.("Creating provider instance", id, { options });
		return factory.create({
			config: this.config,
			id: factory.id
		}, options);
	}
	async generateFull(rawText, provider, onProgress, options) {
		return ttsGenerateFull(rawText, provider, this.config, onProgress, options);
	}
};
function createTtsConductor(config) {
	return new TtsConductor(config);
}
//#endregion
//#region src/defaults.ts
const DEFAULT_PAUSE_TABLE = {
	MICRO: .5,
	SHORT: 1.5,
	MEDIUM: 3.5,
	LONG: 8,
	FULL_BREATH: 5,
	HALF_BREATH: 3,
	SETTLE: 10,
	BREATH: 5
};
//#endregion
export { DEFAULT_PAUSE_TABLE, ProcessStage, TtsAuthenticationError, TtsConductor, TtsError, TtsInvalidInputError, TtsQuotaExceededError, TtsRateLimitError, TtsTransientError, buildFinalAudio, createTtsConductor, estimateAudioDuration, extractPauseMarkers, getAudioDuration, isValidPauseFormat, parsePauseDuration, parseScript, toChunks, ttsGenerateFull, withTimeout };

//# sourceMappingURL=index.mjs.map