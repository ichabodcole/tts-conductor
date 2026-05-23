/**
 * Cross-provider voice catalog interface. Providers that expose a voice picker
 * implement this and expose it via {@link TtsProvider.voiceCatalog}. Providers
 * without a catalog concept (e.g., OpenAI's fixed voice enum, Deepgram's static
 * model strings, a custom self-hosted server) simply omit the property —
 * consumers detect availability via `if (provider.voiceCatalog)`.
 *
 * The shape was informed by surveying ElevenLabs, Cartesia, Hume, Fish.audio,
 * PlayHT, Azure, Google, Piper, OpenAI, and Deepgram on 2026-05-23. Field set
 * captures what appears across ≥3 providers; everything else lives in
 * {@link VoiceCatalogEntry.raw} for consumers who need provider-specific extras.
 */
export interface VoiceCatalog<TRaw = unknown> {
  /**
   * Fetch the catalog. Accepts an optional query for server-side filtering
   * where supported (Cartesia, Fish.audio, Hume's provider param); adapters
   * apply unsupported filters client-side after fetching. The full catalog is
   * always returned as a flat array — adapters loop through any internal
   * pagination so consumers don't have to.
   */
  listVoices(
    query?: VoiceCatalogQuery,
    options?: { signal?: AbortSignal },
  ): Promise<VoiceCatalogEntry<TRaw>[]>;
}

/**
 * Optional filter knobs passed to {@link VoiceCatalog.listVoices}. Adapters
 * push these to server-side query params where supported and apply the rest
 * client-side after fetching. All filters are optional; passing none returns
 * the full catalog.
 */
export interface VoiceCatalogQuery {
  /**
   * Free-text search across name / description / labels. Providers without
   * native search (most) apply this client-side; case-insensitive substring
   * match is the cross-provider baseline.
   */
  search?: string;
  /**
   * Filter to voices supporting this language. Matched as a prefix against
   * `VoiceCatalogEntry.languages` entries (e.g., `'en'` matches `'en-US'` and
   * `'en-GB'`; `'en-US'` matches only `'en-US'`). BCP-47 codes recommended.
   */
  language?: string;
  /**
   * Filter by gender. Case-insensitive string comparison against
   * `VoiceCatalogEntry.gender`. Vocabulary varies per provider; consult the
   * adapter's exported types for the expected values.
   */
  gender?: string;
  /**
   * Filter to account-owned custom voices only (excludes provider presets and
   * community-shared voices). Maps to native server-side filters where
   * available (Cartesia `is_owner`, Hume `CUSTOM_VOICE`, Fish.audio `self`).
   */
  customOnly?: boolean;
}

/**
 * Normalized voice record. The common-base fields appear across most providers
 * with a list endpoint; the `raw: TRaw` field carries the full provider-specific
 * record for consumers who need extras that don't fit the common shape (e.g.,
 * PlayHT's `texture` / `tempo` / `style`, Azure's `StyleList` / `RolePlayList`,
 * Fish.audio's `author` / `like_count`, ElevenLabs' `sharing` / `fine_tuning`).
 */
export interface VoiceCatalogEntry<TRaw = unknown> {
  /**
   * Provider's voice identifier — the opaque string consumers pass to
   * `provider.generate(...)` (typically via `voiceId` in the per-provider
   * options). Consumers should treat this as opaque; identifier formats vary
   * wildly across providers (UUIDs, slugs, encoded BCP-47 strings).
   */
  id: string;
  /** Display name. */
  name: string;
  /**
   * BCP-47 language codes this voice supports. Most voices are
   * single-language (one entry); multilingual voices (Azure SecondaryLocaleList,
   * ElevenLabs verified_languages) carry multiple. Empty array means the
   * provider didn't expose language metadata for this voice.
   */
  languages: string[];
  /**
   * Gender if the provider exposes it. Free-form string because provider
   * vocabularies disagree: "masculine"/"feminine"/"gender_neutral" (Cartesia),
   * "Female"/"Male" (Azure), values embedded in labels (ElevenLabs).
   */
  gender?: string;
  /**
   * Tier / quality / category indicator. Free-form string because there's no
   * cross-provider vocabulary: "studio"/"good"/"ok" (ElevenLabs recording
   * quality), "Neural"/"Standard" (Azure), "low"/"medium"/"high" (Piper),
   * encoded in the voice ID (Google), `hq: boolean` (PlayHT).
   */
  tier?: string;
  /**
   * URL to a sample audio preview. Most providers return naked CDN URLs that
   * can be fetched directly. Some providers (e.g., Cartesia) return URLs that
   * require the same authentication as the SDK to fetch — consumers should
   * consult the adapter's package documentation for per-provider fetch
   * requirements. Treat the URL as opaque from the library's perspective.
   */
  previewUrl?: string;
  /** Description if the provider exposes one. */
  description?: string;
  /**
   * Provider-specific labels (accent, age, use_case, etc.). Free-form because
   * providers expose different label vocabularies. Consult the adapter's
   * exported types if your consumer code wants stricter typing.
   */
  labels?: Record<string, string>;
  /**
   * Whether this voice is an account-owned custom voice (created by cloning or
   * voice design) vs. a provider-curated preset. Undefined when the provider
   * doesn't distinguish (e.g., Google, Azure — entirely provider-managed).
   *
   * Maps to:
   * - ElevenLabs: `is_owner === true`
   * - Cartesia: `is_owner === true`
   * - Hume: `provider === 'CUSTOM_VOICE'`
   * - Fish.audio: voices returned from `?self=true`
   * - PlayHT: voices from the cloned-voices endpoint
   */
  custom?: boolean;
  /**
   * Full provider-specific record. Consumers who need fields the common shape
   * doesn't promote (PlayHT's `texture`, Azure's `StyleList`, Fish.audio's
   * `author`, ElevenLabs' `fine_tuning`, etc.) reach them here. The generic
   * `TRaw` parameter lets adapters declare a concrete shape so consumers get
   * IntelliSense rather than `unknown`.
   */
  raw: TRaw;
}
