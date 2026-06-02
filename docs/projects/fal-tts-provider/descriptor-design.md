# `FalModelDescriptor` design

**Status:** Draft for review (kestrel)
**Created:** 2026-06-02
**Author:** Cole + maestro (Claude)
**Companion:** [proposal.md](./proposal.md) · schemas:
`media-forge/docs/investigations/artifacts/2026-06-02-fal-tts-starter-schemas.md`

> Reviewable shape for the `-fal` package internals, designed against the four
> starter models' real OpenAPI schemas. No package code yet — this is the
> contract we lock before writing it. **kestrel: the gemini `speakers[]` path is
> §4.2.**

---

## 1. Provider flow (per `generate()` call)

The single `fal` provider instance is bound to one `model` at construction. Each
`generate(chunk, options)` call:

1. **Strips** core's `<speak>…</speak>` wrapper from `chunk` → plain `text`.
2. **Resolves** the canonical input: per-call `options.overrides` win over
   construction-time defaults (same precedence rule as the ElevenLabs adapter).
3. **Encodes** via the bound descriptor's `buildInput(canonical)` → the model's
   wire input.
4. **Calls** `fal.subscribe(endpointId, { input, abortSignal: options.signal })`.
5. **Extracts** audio + (optional) duration from the response via the descriptor.
6. **Returns** `GenerationResult` with `providerMeta: { request_id }` — the one
   key that feeds MF's cost reconciliation (core treats it as opaque).

Steps 1, 4, 6 are shared plumbing (one place). Steps 3, 5 are per-model and live
in the descriptor.

## 2. Core types

```ts
/** Supported fal endpoint ids — extended as models are added. */
type FalModelId =
  | "fal-ai/minimax/speech-02-hd"
  | "fal-ai/gemini-3.1-flash-tts"
  | "fal-ai/chatterbox/text-to-speech"
  | "fal-ai/elevenlabs/tts/turbo-v2.5";

/** Polymorphic voice selection — the union that spans fal's mechanisms.
 *  Object-voice (minimax voice_setting) is NOT a separate kind: it's a `preset`
 *  id that the descriptor nests into an object. */
type FalVoiceSelection =
  | { kind: "preset"; id: string } // gemini/elevenlabs/minimax voice id
  | { kind: "multiSpeaker"; speakers: FalSpeaker[] } // gemini speakers[]
  | { kind: "clone"; audioUrl: string }; // chatterbox audio_url

interface FalSpeaker {
  /** Alias used as a line prefix in the prompt (e.g. "Host:"). → SpeakerConfig.speaker_id */
  speakerId: string;
  /** A preset voice name. → SpeakerConfig.voice */
  voiceId: string;
}

/** The normalized, model-agnostic input the provider assembles before a
 *  descriptor maps it to wire shape. Lives entirely in `-fal`. */
interface CanonicalTtsInput {
  /** <speak>-stripped chunk text. */
  text: string;
  /** Resolved voice selection (override ?? construction default). */
  voice?: FalVoiceSelection;
  /** Resolved model-specific scalar knobs (speed, temperature, stability, …).
   *  Opaque at this layer; the descriptor whitelists/forwards what it supports. */
  params?: Record<string, unknown>;
  /** Output format, when the model offers a choice. */
  outputFormat?: string;
}

interface FalModelDescriptor {
  endpointId: FalModelId;
  /** Per-model caps (incl. maxCharsPerRequest). fal won't render SSML breaks,
   *  so maxInlineBreakSeconds is always null here. */
  caps: ProviderCapabilities;
  /** Canonical → this model's wire input. Owns the text key, voice encoding,
   *  param passthrough, and static defaults. The single mapping path (see §3). */
  buildInput(input: CanonicalTtsInput): Record<string, unknown>;
  /** Pull audio bytes (+ mime) out of this model's fal response shape. */
  extractAudio(data: unknown): { audio: Buffer; mimeType?: string };
  /** Pull duration from the response when present, to skip core's ffprobe. */
  extractDuration?(data: unknown): number | undefined;
  /** Enumerable speaker list, for models that have one (see §5). */
  voiceCatalog?: VoiceCatalog;
}
```

## 3. One mapping path, not two (refinement)

The proposal floated "declarative `fieldMap` for the 90%, `buildInput` escape
hatch for the 10%." **On contact with the real schemas I recommend collapsing to
a single mandatory `buildInput`** — because:

- All four starters need a function anyway (3 for structural reasons; even the
  "flat" elevenlabs one still maps voice → `voice` and forwards scalars).
- A declarative table saved ~2 lines per simple model but added a second code
  path (resolve-or-call) and a `textKey`/`fieldMap` sub-language to maintain.

To keep the declarative _ergonomics_ for the genuinely-flat models without a
second path, a tiny helper **produces** a `buildInput`:

```ts
/** Flat models: text at `textKey`, voice id at `voiceKey`, scalar params merged. */
function flatBuildInput(opts: {
  textKey: "text" | "prompt";
  voiceKey: string;
  defaults?: Record<string, unknown>;
}) {
  return (input: CanonicalTtsInput): Record<string, unknown> => ({
    ...opts.defaults,
    [opts.textKey]: input.text,
    ...(input.voice?.kind === "preset"
      ? { [opts.voiceKey]: input.voice.id }
      : {}),
    ...(input.params ?? {}),
  });
}
```

So a flat model is still ~1 line; weird models supply a hand-written function.
One code path everywhere. (Open question Q1 — confirm you're happy dropping the
declarative-data framing for the helper-factory framing.)

## 4. The four starter descriptors

### 4.1 `minimax/speech-02-hd` — object-voice nesting

`text` key; voice id nests into a `voice_setting` object alongside vol/speed/pitch.

```ts
buildInput(input) {
  const vs = input.params?.voiceSetting as Record<string, unknown> | undefined;
  return {
    text: input.text,                                  // max 5000 (caps.maxCharsPerRequest)
    voice_setting: {
      voice_id: input.voice?.kind === 'preset' ? input.voice.id : 'Wise_Woman',
      ...(vs ?? {}),                                   // vol 0.01-10, speed 0.5-2, pitch, emotion, english_normalization
    },
    ...(input.params?.audioSetting ? { audio_setting: input.params.audioSetting } : {}),
    ...(input.params?.languageBoost ? { language_boost: input.params.languageBoost } : {}),
    output_format: 'hex',                               // we want bytes, not a URL (default is hex)
  };
}
// caps.maxCharsPerRequest = 5000 ; voiceCatalog = static minimax presets (§5)
```

### 4.2 `gemini-3.1-flash-tts` — multi-speaker (the stress test)

**`prompt`** key (not `text`). Single-speaker uses `voice` (enum); multi-speaker
uses `speakers: SpeakerConfig[]` and the _prompt itself_ carries `Alias:`
line-prefixes. `style_instructions` is separate delivery control.

```ts
buildInput(input) {
  const base = {
    prompt: input.text,                                // max 50000
    ...(input.params?.styleInstructions ? { style_instructions: input.params.styleInstructions } : {}),
    ...(input.params?.languageCode ? { language_code: input.params.languageCode } : {}),
    ...(input.params?.temperature !== undefined ? { temperature: input.params.temperature } : {}),
    output_format: 'mp3',
  };
  if (input.voice?.kind === 'multiSpeaker') {
    return {
      ...base,
      // SpeakerConfig requires { voice, speaker_id }; 2–10 entries.
      speakers: input.voice.speakers.map((s) => ({ speaker_id: s.speakerId, voice: s.voiceId })),
    };
  }
  // single-speaker: `voice` enum (default Kore); `speakers` omitted.
  return { ...base, voice: input.voice?.kind === 'preset' ? input.voice.id : 'Kore' };
}
// caps.maxCharsPerRequest = 50000 ; voiceCatalog = static 30-voice gemini enum (§5)
```

**Note for multi-speaker + chunking:** the alias-prefix convention lives in the
script text, so multi-speaker only works coherently if the prefixes survive
chunking. For the starter integration we'll treat multi-speaker as a
single-chunk / short-form path and document that long multi-speaker scripts need
the prefixes intact per chunk. (Open question Q2 — is single-chunk multi-speaker
enough for MF's first use, or do you need chunk-aware speaker continuity?)

### 4.3 `chatterbox/text-to-speech` — clone-from-URL

`text` key; no voice id — `audio_url` is a **plain URL string** (your File
finding). When no clone URL is given, fal uses its demo voice default.

```ts
buildInput(input) {
  return {
    text: input.text,                                  // max 5000
    ...(input.voice?.kind === 'clone' ? { audio_url: input.voice.audioUrl } : {}),
    ...(input.params?.exaggeration !== undefined ? { exaggeration: input.params.exaggeration } : {}), // 0-1
    ...(input.params?.cfg !== undefined ? { cfg: input.params.cfg } : {}),                             // 0.1-1
    ...(input.params?.temperature !== undefined ? { temperature: input.params.temperature } : {}),     // 0.05-2
    ...(input.params?.seed !== undefined ? { seed: input.params.seed } : {}),
  };
}
// caps.maxCharsPerRequest = 5000 ; voiceCatalog = undefined (clone-only)
```

### 4.4 `elevenlabs/tts/turbo-v2.5` — flat declarative

The one flat model: `flatBuildInput`, plus the 11labs scalar knobs forwarded.

```ts
buildInput: flatBuildInput({
  textKey: 'text',
  voiceKey: 'voice',          // default 'Rachel'
  // stability/similarity_boost/style/speed/previous_text/next_text/language_code
  // ride input.params; apply_text_normalization default 'auto'.
}),
// voiceCatalog = static 11labs-on-fal voice list (§5) — note: may be a documented
// subset, not the full account catalog (the fal enum lists examples).
```

## 5. `voiceCatalog` wiring

`voiceCatalog` stays narrow ("what speakers can I enumerate?"). Three of the four
expose a static, documented voice list; one is clone-only:

| Model             | voiceCatalog                                                                |
| ----------------- | --------------------------------------------------------------------------- |
| gemini            | static — the 30-voice enum (Kore, Puck, Charon, …) → `VoiceCatalogEntry[]`  |
| elevenlabs-on-fal | static — documented voice names (Rachel, Aria, …); flag as possibly-partial |
| minimax           | static — preset `voice_id`s (Wise_Woman, …)                                 |
| chatterbox        | **undefined** — clone-only, no enumerable speakers                          |

Static catalogs filter client-side (the cross-provider baseline). Language/gender
metadata is sparse in the fal enums, so most entries carry just `id`/`name` +
`raw`.

## 6. Open questions for kestrel

- **Q1.** OK to drop the declarative-table framing for the single
  `buildInput` + `flatBuildInput` helper (§3)? Same ergonomics, one code path.
- **Q2.** Multi-speaker scope (§4.2): single-chunk/short-form acceptable for the
  first MF integration, or do you need chunk-aware speaker continuity now?
- **Q3.** `extractAudio`/`extractDuration` (§2): can you share the **response**
  shapes for these four (the schemas were input-only)? Specifically whether each
  returns an audio URL to fetch vs inline bytes/base64, and whether a duration
  field is present — that determines `extractAudio` and whether we skip ffprobe.
- **Q4.** `params` is opaque (`Record<string, unknown>`) at the canonical layer.
  Acceptable for the alpha, or do you want per-model typed param objects on the
  construction options (stronger typing, bigger surface)?
