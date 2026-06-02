# @alien-lobster-buffet/tts-conductor-fal

[fal.ai](https://fal.ai) provider bindings for the
[TTS Conductor](https://github.com/ichabodcole/tts-conductor) ecosystem.

fal.ai is a **gateway fronting many TTS engines**, each with its own input and
voice schema. This package models that as a single `fal` provider id that you
parameterize with a `model` at construction — so the marketplace lives at
construction time while each provider _instance_ is still one engine, fully
honoring the conductor's `TtsProvider` contract (one `caps`, one `generate`, one
optional `voiceCatalog`).

## Install

```sh
npm install @alien-lobster-buffet/tts-conductor-core @alien-lobster-buffet/tts-conductor-fal
```

Requires a fal API key (`FAL_KEY`).

## Quickstart

```ts
import { createTtsConductor } from "@alien-lobster-buffet/tts-conductor-core";
import { falProviderFactory } from "@alien-lobster-buffet/tts-conductor-fal";

const conductor = createTtsConductor({ pauseTable: {}, maxPauseSeconds: 30 });
conductor.registerProvider(falProviderFactory);

const provider = conductor.createProvider("fal", {
  apiKey: process.env.FAL_KEY!,
  model: "fal-ai/minimax/speech-02-hd",
  voice: { kind: "preset", id: "Wise_Woman" },
});

const { audio, duration, providerMeta } = await conductor.generateFull(
  "Hello there. [PAUSE:2s] Welcome.",
  provider,
);
```

## Starter models

| `model`                            | text key | voice mechanism                                                                  | duration               |
| ---------------------------------- | -------- | -------------------------------------------------------------------------------- | ---------------------- |
| `fal-ai/minimax/speech-02-hd`      | `text`   | `{ kind: 'preset', id }` → `voice_setting` object                                | native (`duration_ms`) |
| `fal-ai/gemini-3.1-flash-tts`      | `prompt` | `{ kind: 'preset', id }` (30-voice enum) or `{ kind: 'multiSpeaker', speakers }` | ffprobe                |
| `fal-ai/chatterbox/text-to-speech` | `text`   | `{ kind: 'clone', audioUrl }` (no preset voices)                                 | ffprobe                |
| `fal-ai/elevenlabs/tts/turbo-v2.5` | `text`   | `{ kind: 'preset', id }`                                                         | ffprobe                |

Switch model and voice at construction, or vary them per call:

```ts
await provider.generate(chunk, {
  overrides: {
    voice: { kind: "preset", id: "Aria" },
    params: { stability: 0.3 },
  },
});
```

`params` carries the model's scalar knobs (e.g. minimax `voiceSetting`, gemini
`styleInstructions` / `temperature`, chatterbox `exaggeration` / `cfg`, 11labs
`stability` / `similarity_boost` / `speed`). Each descriptor forwards only the
keys it recognizes.

## Voice discovery

Only `fal-ai/gemini-3.1-flash-tts` exposes a `voiceCatalog` — its 30 preset
voices are the one schema-enumerable set. minimax and elevenlabs-on-fal take a
voice id as a free string (pass a known id), and chatterbox clones from
`audio_url`; all three leave `voiceCatalog` undefined.

```ts
if (provider.voiceCatalog) {
  const voices = await provider.voiceCatalog.listVoices({ search: "kore" });
}
```

> Gemini voices carry no per-voice language metadata (the model is multilingual
> via the `languageCode` param), so `listVoices({ language })` filters them all
> out. Filter by `search` instead.

## Cost reconciliation

fal bills asynchronously. Each chunk's fal `request_id` is surfaced on the
generation result via core's generic `providerMeta` channel — collect them from
the final result and reconcile against fal's billing-events API:

```ts
const result = await conductor.generateFull(text, provider);
const requestIds =
  result.providerMeta?.map((m) => m?.request_id).filter(Boolean) ?? [];
```

## Notes

- **Multi-speaker (gemini) is single-chunk / short-form for now.** fal needs the
  full `speakers[]` on every request and the prompt's `Alias:` line-prefixes to
  survive chunking; long multi-speaker scripts aren't supported yet.
- fal engines don't render SSML breaks — inter-chunk pauses become stitched
  silence segments via the core orchestrator.

## License

MIT
