import type {
  VoiceCatalog,
  VoiceCatalogEntry,
  VoiceCatalogQuery,
} from '@alien-lobster-buffet/tts-conductor-core';

/**
 * Build a `VoiceCatalog` from a fixed list of entries, applying the
 * cross-provider client-side filter baseline (case-insensitive substring search;
 * language prefix-match; gender equality; custom-only). Used for fal models
 * whose voices are a schema-enumerable set.
 */
export function staticVoiceCatalog<TRaw = unknown>(
  entries: ReadonlyArray<VoiceCatalogEntry<TRaw>>,
): VoiceCatalog<TRaw> {
  return {
    async listVoices(query?: VoiceCatalogQuery): Promise<VoiceCatalogEntry<TRaw>[]> {
      let result = [...entries];
      if (query?.search) {
        const q = query.search.toLowerCase();
        result = result.filter((v) =>
          [v.name, v.description, ...Object.values(v.labels ?? {})]
            .filter((s): s is string => typeof s === 'string')
            .some((s) => s.toLowerCase().includes(q)),
        );
      }
      if (query?.language) {
        const lang = query.language.toLowerCase();
        result = result.filter((v) => v.languages.some((l) => l.toLowerCase().startsWith(lang)));
      }
      if (query?.gender) {
        const g = query.gender.toLowerCase();
        result = result.filter((v) => v.gender?.toLowerCase() === g);
      }
      if (query?.customOnly) {
        result = result.filter((v) => v.custom === true);
      }
      return result;
    },
  };
}

/** Raw shape for a gemini voice entry — just the preset name. */
export interface GeminiRawVoice {
  name: string;
}

/**
 * The 30 gemini-3.1-flash-tts preset voices, straight from the model's OpenAPI
 * `voice` enum (authoritative). gemini is multilingual via `language_code`
 * rather than per-voice, so `languages` is left empty.
 */
const GEMINI_VOICE_NAMES = [
  'Achernar',
  'Achird',
  'Algenib',
  'Algieba',
  'Alnilam',
  'Aoede',
  'Autonoe',
  'Callirrhoe',
  'Charon',
  'Despina',
  'Enceladus',
  'Erinome',
  'Fenrir',
  'Gacrux',
  'Iapetus',
  'Kore',
  'Laomedeia',
  'Leda',
  'Orus',
  'Pulcherrima',
  'Puck',
  'Rasalgethi',
  'Sadachbia',
  'Sadaltager',
  'Schedar',
  'Sulafat',
  'Umbriel',
  'Vindemiatrix',
  'Zephyr',
  'Zubenelgenubi',
] as const;

export const geminiVoiceCatalog: VoiceCatalog<GeminiRawVoice> = staticVoiceCatalog(
  GEMINI_VOICE_NAMES.map((name) => ({ id: name, name, languages: [], raw: { name } })),
);
