# 2026-05-23 — Voice catalog API (A6)

## Goals

Add cross-provider voice catalog support so consumers building voice-picker UIs can list available voices through the library instead of maintaining a parallel SDK client. Per `docs/backlog.md` item A6.

The shape was informed by a deliberate landscape analysis rather than guessed from a single provider — Cole flagged the abstraction concern early and asked for research before settling on the contract. We surveyed 10 TTS providers (ElevenLabs, Cartesia, OpenAI, Deepgram, Hume, Fish.audio, PlayHT, Azure, Google, Piper) and pulled patterns from OpenRouter's `/v1/models` design for "many providers, common base + per-provider extensions."

## Completed Work

### Core — opt-in extension interface

New `packages/tts-core/src/voice-catalog.ts` exports:

- `VoiceCatalog<TRaw = unknown>` — `listVoices(query?, options?): Promise<VoiceCatalogEntry<TRaw>[]>`
- `VoiceCatalogEntry<TRaw>` — 9 common fields + `raw: TRaw` escape hatch:
  - Universal (8/8 providers with catalogs): `id`, `name`
  - Strong (5+/8): `languages: string[]`, `gender?`, `tier?`
  - Medium (3-4/8): `previewUrl?`, `description?`, `labels?`, `custom?`
  - `raw: TRaw` — full provider record for extras
- `VoiceCatalogQuery` — `search?`, `language?`, `gender?`, `customOnly?`
- Added `readonly voiceCatalog?: VoiceCatalog` to `TtsProvider` — optional, providers without a catalog concept (OpenAI's fixed enum, Deepgram's static strings, self-hosted servers) omit it; consumers detect via `if (provider.voiceCatalog) { ... }`

### ElevenLabs adapter — concrete catalog

`packages/tts-provider-elevenlabs/src/voiceCatalog.ts` implements `VoiceCatalog<ElevenLabsRawVoice>`:

- Uses SDK's `voices.search()` (v2 endpoint, native pagination + `search` filter)
- Loops through pages internally so consumers receive a flat array per contract
- Server-side filter mapping: `query.search → SDK search`, `query.customOnly: true → SDK voiceType: 'personal'`
- Client-side filter application: `language` (BCP-47 prefix match — `'en'` matches `'en-US'` and `'en-GB'`), `gender` (case-insensitive)
- Field mapping with documented fallback chains:
  - `voiceId → id`
  - `verifiedLanguages[].language` (filtered for non-empty) → `languages[]`; falls back to `labels.language`; empty array if neither
  - `labels?.gender → gender` (free-form, no normalization — ElevenLabs encodes gender as label key)
  - `recordingQuality ?? category → tier`
  - `previewUrl ?? undefined` (null-strip)
  - `isOwner ?? undefined → custom`
- Wired into `ElevenLabsProvider` as `readonly voiceCatalog: VoiceCatalog<ElevenLabsRawVoice>` (always present for this adapter)

Adapter also exports type helpers per the "narrowed types per provider" pattern we settled in the digestify:

- `ElevenLabsRawVoice` — re-exported SDK type
- `ElevenLabsRecordingQuality` — narrowed enum for `tier`
- `ElevenLabsVoiceCategory` — narrowed enum

### Decisions that landed (from the design conversations)

- **`languages: string[]`** not `language?: string` — multilingual voices are real (Azure SecondaryLocaleList, ElevenLabs verifiedLanguages).
- **`gender`, `tier` as free-form strings** — provider vocabularies are too divergent to fit an enum without losing information.
- **`custom?: boolean`** instead of the original `owned?` — Cole flagged the ambiguity; this captures "is this an account-curated voice" clearly.
- **`previewUrl: string`** (not an object with headers) — Cole's backend-first use case means consumers already have provider auth context; embedding credentials in returned data was a code smell.
- **No `capabilities[]` array yet** — OpenRouter pattern is real but not enough cross-provider pressure today. Skip for v1, add when needed.
- **No built-in caching** — consumers can wrap trivially; library state would be more confusing than helpful.
- **Optional `voiceCatalog?` on `TtsProvider`** rather than `validateVoice` / required methods — providers without catalogs cleanly omit.

## Verification

`bun run check` (typecheck + Biome `--error-on-warnings` + 102 tests) green.

## Code Review

Dispatched `feature-dev:code-reviewer`. Verdict: **"Ready to merge: With fixes."** Two important findings + one minor coverage gap + one documentation item. All addressed.

**Important fix 1 (confidence 85): pagination silent truncation.** If the SDK ever returns `hasMore: true` without a `nextPageToken`, the original code would silently exit the loop with a truncated catalog — violating the "flat array, adapter loops through all pagination" contract. ElevenLabs always returns the token in practice, but a future SDK regression would have produced partial catalogs without errors. Fixed with a defensive `throw new TtsError(...)` guard. Added a regression test that mocks `{ hasMore: true, nextPageToken: undefined }` and asserts the throw.

**Important fix 2 (confidence 82): missing type-level guard test for the conductor-path `voiceCatalog`.** The conductor's `createProvider` returns `TtsProvider<CallOverridesFor<T>>`, which has `voiceCatalog?: VoiceCatalog<unknown>` — the `ElevenLabsRawVoice` generic is erased at the abstract `TtsProvider` boundary because we can't carry per-provider raw-record types through a generic interface without adding a second registry. This is intentional (consumers needing the typed raw record use `ElevenLabsVoiceCatalog` directly), but the existing `typed-integration.test.ts` had no test exercising the conductor-path `voiceCatalog` access. Added one — pins down the intentional design with an inline explanation so future maintainers don't try to "fix" the erasure without understanding the trade-off.

**Coverage gap (Q8 note): filter test for empty/undefined `verifiedLanguages` entries.** The mapping code defensively filters out entries with missing or empty `language` fields. Added a test that mocks a mix of `[{ language: 'en-US' }, { language: undefined }, { language: '' }, { language: 'fr-FR' }]` and asserts the output is `['en-US', 'fr-FR']`.

**Documentation item (Q7): ElevenLabs adapter known limitations.** The reviewer flagged that `gender` extraction relies on `voice.labels?.gender` (the SDK encodes gender as a free-form label key, not a structured field) — minor caveat for ElevenLabs custom voices that omit the label. Documented in `docs/deferred-items.md` under a new "D8c. ElevenLabs adapter known limitations" entry, together with the `tier` fallback semantic (recordingQuality vs category conflation). No code change — just keeping the gotchas tracked.

**Reviewer affirmations (no fix needed):**

- The "always present on `ElevenLabsProvider`, optional on `TtsProvider`" asymmetry is correct (TypeScript structural compatibility)
- `raw: TRaw` defaulting to `unknown` is the right pattern (consumers get narrowing via the adapter directly or by typing `VoiceCatalogEntry<ElevenLabsRawVoice>`)
- Unbounded memory accumulation in the pagination loop is acceptable for v1 (ElevenLabs catalog sizes are bounded)
- Defensive `signal.throwIfAborted()` layering inside the loop is correct (catches aborts in the inter-page window the SDK's `abortSignal` doesn't cover)
- `startsWith` semantic for language filter is the right tradeoff
- `tier` fallback `recordingQuality → category` is the right priority
- Tests genuinely exercise mapping/pagination logic (the `makeClient` injection pattern bypasses `vi.mock` brittleness; the real `mapToCatalogEntry` and pagination loop run under test)

## Outcomes

Voice catalog interface is in place — opt-in, generic in `TRaw`, with concrete ElevenLabs implementation and adapter-exported type helpers. Future providers (Cartesia, Hume.ai, Fish.audio, Azure, Google, etc.) implement the same interface and consumer voice-picker code stays portable. The 13+3 tests cover the mapping, pagination, filters, abort signal, defensive guards, and the conductor-path typecheck.

## Files Modified

- `packages/tts-core/src/voice-catalog.ts` — new module
- `packages/tts-core/src/provider.ts` — `voiceCatalog?: VoiceCatalog` on `TtsProvider`
- `packages/tts-core/src/index.ts` — exports
- `packages/tts-provider-elevenlabs/src/voiceCatalog.ts` — `ElevenLabsVoiceCatalog` class + type helpers
- `packages/tts-provider-elevenlabs/src/elevenLabsProvider.ts` — wires `voiceCatalog` onto the provider
- `packages/tts-provider-elevenlabs/src/index.ts` — exports `ElevenLabsVoiceCatalog`, `ElevenLabsRawVoice`, `ElevenLabsRecordingQuality`, `ElevenLabsVoiceCategory`
- `packages/tts-provider-elevenlabs/src/__tests__/voiceCatalog.test.ts` — 15 tests (13 original + pagination-guard + verifiedLanguages-filter)
- `packages/tts-provider-elevenlabs/src/__tests__/typed-integration.test.ts` — adds conductor-path `voiceCatalog` typecheck guard
- `docs/deferred-items.md` — D8b (fetchPreview helper deferred), D8c (ElevenLabs adapter known limitations)
- `packages/tts-core/dist/*` — rebuilt

## Follow-ups (tracked in `docs/deferred-items.md`)

- **D8b — `fetchPreview` helper** on the provider or as a free function exported from each adapter. Confirmed mutual interest in this on 2026-05-23 but deferred until a real consumer asks. Bare-URL contract today.
- **D8c — ElevenLabs gender / tier mapping caveats.** Documented in deferred-items for visibility; not a code issue.

Pre-existing deferred items unchanged.

The shape of `VoiceCatalogEntry` is now the contract every future provider adapter implements. The next provider that lands (Cartesia, Hume, Fish.audio, etc.) gets its voice picker UX for free at the consumer level.
