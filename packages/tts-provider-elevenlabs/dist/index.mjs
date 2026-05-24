import { TtsAuthenticationError, TtsError, TtsInvalidInputError, TtsQuotaExceededError, TtsRateLimitError, TtsTransientError, getAudioDuration } from "@alien-lobster-buffet/tts-conductor-core";
import { ElevenLabsClient, ElevenLabsError, ElevenLabsTimeoutError } from "@elevenlabs/elevenlabs-js";
//#region src/voiceCatalog.ts
/**
* Page size used when fetching the catalog via ElevenLabs' v2 search endpoint.
* 100 is the SDK's max; lower wouldn't hurt correctness but would multiply
* round-trips for accounts with large catalogs.
*/
const CATALOG_PAGE_SIZE = 100;
/**
* Convenience factory: construct an {@link ElevenLabsVoiceCatalog} from just an
* API key, without requiring the consumer to import `@elevenlabs/elevenlabs-js`
* themselves. Equivalent to `new ElevenLabsVoiceCatalog(new ElevenLabsClient({ apiKey }))`,
* but keeps the SDK as an internal dependency of this adapter.
*/
function createElevenLabsCatalog(apiKey) {
	if (!apiKey) throw new Error("createElevenLabsCatalog requires a non-empty apiKey");
	return new ElevenLabsVoiceCatalog(new ElevenLabsClient({ apiKey }));
}
var ElevenLabsVoiceCatalog = class {
	constructor(client) {
		this.client = client;
	}
	async listVoices(query, options) {
		options?.signal?.throwIfAborted();
		const collected = [];
		let nextPageToken;
		do {
			options?.signal?.throwIfAborted();
			const response = await this.client.voices.search({
				pageSize: CATALOG_PAGE_SIZE,
				search: query?.search,
				voiceType: query?.customOnly ? "personal" : void 0,
				nextPageToken
			}, { abortSignal: options?.signal });
			collected.push(...response.voices);
			if (response.hasMore && !response.nextPageToken) throw new TtsError("[11labs] voice catalog pagination: hasMore=true but no nextPageToken supplied");
			nextPageToken = response.hasMore ? response.nextPageToken : void 0;
		} while (nextPageToken);
		let entries = collected.map((v) => mapToCatalogEntry(v));
		if (query?.language) {
			const wanted = query.language.toLowerCase();
			entries = entries.filter((e) => e.languages.some((l) => l.toLowerCase().startsWith(wanted)));
		}
		if (query?.gender) {
			const wanted = query.gender.toLowerCase();
			entries = entries.filter((e) => e.gender?.toLowerCase() === wanted);
		}
		return entries;
	}
};
function mapToCatalogEntry(voice) {
	return {
		id: voice.voiceId,
		name: voice.name ?? "",
		languages: extractLanguages(voice),
		gender: voice.labels?.gender,
		tier: voice.recordingQuality ?? voice.category,
		previewUrl: voice.previewUrl ?? void 0,
		description: voice.description ?? void 0,
		labels: voice.labels,
		custom: voice.isOwner ?? void 0,
		raw: voice
	};
}
function extractLanguages(voice) {
	if (voice.verifiedLanguages && voice.verifiedLanguages.length > 0) return voice.verifiedLanguages.map((vl) => vl.language).filter((l) => typeof l === "string" && l.length > 0);
	const fromLabel = voice.labels?.language;
	return typeof fromLabel === "string" && fromLabel.length > 0 ? [fromLabel] : [];
}
//#endregion
//#region src/elevenLabsProvider.ts
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
const ELEVENLABS_DEFAULTS = {
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
	outputFormat: "mp3_44100_128",
	/**
	* Quality-tier → SDK model ID mapping. `high` deliberately maps to the same
	* model as `standard` because `eleven_multilingual_v2` is the highest-quality
	* model ElevenLabs currently exposes for this use case; `draft` swaps to the
	* faster turbo model.
	*/
	models: {
		draft: "eleven_turbo_v2_5",
		standard: "eleven_multilingual_v2",
		high: "eleven_multilingual_v2"
	}
};
const CAPS = {
	maxInlineBreakSeconds: ELEVENLABS_DEFAULTS.maxInlineBreakSeconds,
	maxCharsPerRequest: ELEVENLABS_DEFAULTS.maxCharsPerRequest,
	renderInlineBreak: (seconds) => `<break time="${seconds}s" />`
};
var ElevenLabsProvider = class {
	constructor(ctx, options) {
		this.ctx = ctx;
		this.options = options;
		this.caps = CAPS;
		this.id = ctx.id;
		this.client = new ElevenLabsClient({ apiKey: options.apiKey });
		this.voiceCatalog = new ElevenLabsVoiceCatalog(this.client);
	}
	async generate(chunk, options) {
		const overrides = options?.overrides;
		const signal = options?.signal;
		signal?.throwIfAborted();
		const voiceId = overrides?.voiceId ?? this.options.voiceId;
		const quality = overrides?.quality ?? this.options.quality ?? "standard";
		const voiceSettings = overrides?.voiceSettings ?? this.options.voiceSettings;
		const logger = this.ctx.config.logger;
		const convertOptions = {
			text: chunk,
			outputFormat: ELEVENLABS_DEFAULTS.outputFormat,
			modelId: ELEVENLABS_DEFAULTS.models[quality] ?? ELEVENLABS_DEFAULTS.models.standard
		};
		if (voiceSettings) convertOptions.voiceSettings = voiceSettings;
		logger?.info?.("[11labs] convert start", {
			voiceId,
			modelId: convertOptions.modelId
		});
		try {
			const buffer = await streamToBuffer(await this.client.textToSpeech.convert(voiceId, convertOptions, { abortSignal: signal }));
			logger?.info?.("[11labs] convert done", { bytes: buffer.length });
			const duration = await getAudioDuration(buffer, this.ctx.config.ffmpeg, logger, signal);
			logger?.info?.("[11labs] duration", { duration });
			return {
				audio: buffer,
				mimeType: "audio/mpeg",
				duration,
				size: buffer.length
			};
		} catch (error) {
			if (signal?.aborted || isAbortError(error)) throw error;
			const mapped = mapElevenLabsError(error);
			logger?.error?.("[11labs] generation error", {
				message: mapped.message,
				kind: mapped.name,
				statusCode: mapped.statusCode
			});
			throw mapped;
		}
	}
};
/**
* Detect a native AbortError. Covers both `DOMException` aborts (modern Node
* fetch) and Node-style errors with `name === 'AbortError'` (execa, older
* runtimes). Useful when we don't have access to the controlling signal but
* still need to recognize cancellation in a catch block.
*/
function isAbortError(error) {
	return error instanceof Error && error.name === "AbortError";
}
/**
* Convert an error thrown by the ElevenLabs SDK into one of the `@alien-lobster-buffet/tts-conductor-core`
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
function mapElevenLabsError(error) {
	if (error instanceof ElevenLabsTimeoutError) return new TtsTransientError(`ElevenLabs request timed out: ${error.message}`, { cause: error });
	if (error instanceof ElevenLabsError) {
		const status = error.statusCode;
		const message = `ElevenLabs ${status ?? "request"} failed: ${error.message}`;
		const opts = {
			cause: error,
			statusCode: status
		};
		if (status === void 0) return new TtsTransientError(message, opts);
		if (status === 401) return new TtsAuthenticationError(message, opts);
		if (status === 403) return new TtsQuotaExceededError(message, opts);
		if (status === 429) return new TtsRateLimitError(message, {
			...opts,
			retryAfterMs: extractRetryAfterMs(error)
		});
		if (status >= 500) return new TtsTransientError(message, opts);
		if (status >= 400) return new TtsInvalidInputError(message, opts);
		return new TtsError(message, opts);
	}
	return new TtsError(`ElevenLabs generation failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
}
/**
* Parse a Retry-After header value into milliseconds. The header may be either a number
* of seconds (e.g., `"30"`) or an HTTP date. Returns undefined if the header is absent,
* unparseable, or the rawResponse is not available.
*/
function extractRetryAfterMs(error) {
	const headers = error.rawResponse?.headers;
	if (!headers) return void 0;
	const raw = readHeader(headers, "retry-after");
	if (raw === void 0) return void 0;
	const seconds = Number.parseFloat(raw);
	if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1e3);
	const epochMs = Date.parse(raw);
	if (!Number.isNaN(epochMs)) {
		const diff = epochMs - Date.now();
		return diff > 0 ? diff : void 0;
	}
}
function readHeader(headers, name) {
	if (headers && typeof headers.get === "function") return headers.get(name) ?? void 0;
	if (headers && typeof headers === "object") {
		const record = headers;
		const value = record[name] ?? record[name.toLowerCase()];
		if (Array.isArray(value)) return value[0];
		return value;
	}
}
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
		nodeStream.on("data", (data) => nodeChunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data)));
		nodeStream.on("end", () => resolve(Buffer.concat(nodeChunks)));
		nodeStream.on("error", reject);
	});
}
const elevenLabsProviderFactory = {
	id: "11labs",
	create(ctx, options) {
		if (!options.apiKey) throw new Error("ElevenLabs provider requires an apiKey");
		if (!options.voiceId) throw new Error("ElevenLabs provider requires a voiceId");
		return new ElevenLabsProvider(ctx, options);
	}
};
//#endregion
export { ELEVENLABS_DEFAULTS, ElevenLabsVoiceCatalog, createElevenLabsCatalog, elevenLabsProviderFactory };

//# sourceMappingURL=index.mjs.map