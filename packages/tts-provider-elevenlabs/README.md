# @tts-conductor/provider-elevenlabs

ElevenLabs provider factory for the TTS Conductor ecosystem. Creates `TtsProvider` instances backed by the official `@elevenlabs/elevenlabs-js` SDK and reuses the shared FFmpeg helpers for duration metadata.

## Usage

```ts
import { createTtsConductor, DEFAULT_PAUSE_TABLE } from "@tts-conductor/core";
import { elevenLabsProviderFactory } from "@tts-conductor/provider-elevenlabs";

// Instantiate the conductor once at application startup.
const conductor = createTtsConductor({
  pauses: DEFAULT_PAUSE_TABLE,
  logger: console,
});

// Register the factory once so the conductor knows how to build ElevenLabs providers.
const elevenLabsId = conductor.registerProvider(elevenLabsProviderFactory);

// Create a configured provider instance when you need to generate audio.
// TypeScript enforces correct option types for '11labs' provider
const provider = conductor.createProvider("11labs", {
  apiKey: process.env.ELEVENLABS_API_KEY!,
  voiceId: "your-voice-id",
  quality: "standard", // ✅ TypeScript validates this
  voiceSettings: {
    stability: 0.5,
    similarityBoost: 0.8,
  },
});

const result = await conductor.generateFull("Hello world", provider);
```

## Model + format guidance

The defaults in `ELEVENLABS_DEFAULTS` are tuned for long-form narration (guided
visualization, hypnosis, storytelling) — the workloads this library was built
around:

- **`quality: 'standard'` → `eleven_multilingual_v2`** is the default and the
  recommendation. It's the highest-quality model ElevenLabs currently exposes
  for this use case. `quality: 'high'` maps to the same model (no upgrade
  path beyond `standard` exists yet) and is kept as an alias so consumers can
  express intent without us having to bump the contract when a higher tier
  ships.
- **`quality: 'draft'` → `eleven_turbo_v2_5`** is faster and cheaper, but
  the quality drop is audible on long-form content (compression artifacts,
  occasional prosody glitches). Use it for previewing scripts during
  iteration, not for final delivery.
- **`outputFormat: 'mp3_44100_128'`** matches the core's intermediate-audio
  pipeline (44.1kHz mono) and is the right pick whenever you're going through
  the stitcher. Changing it forces an extra resample inside ffmpeg with no
  quality gain.

## Tuning throughput vs. progress granularity

`ELEVENLABS_DEFAULTS.maxCharsPerRequest` is `1200`. ElevenLabs' actual
server-side limit is around `~5000` characters (well-observed, not
officially documented). The conservative default trades a small amount of
total throughput for finer progress reporting and faster cancellation
response — useful when you're surfacing a progress bar to a user or running
inside a job queue with stall detection.

If you're bulk-generating without a UI or want to minimize round-trip
overhead, override per-call:

```ts
await conductor.generateFull("...long script...", provider, undefined, {
  maxCharsPerRequest: 4000,
});
```

Going above `~5000` will start hitting the server-side limit and surface as
`TtsInvalidInputError`.

## Scripts

- `bun run build` – compile sources to `dist/`
- `bun run dev` – rebuild on change
- `bun run lint` – run Biome over `src/`
- `bun run test` – run Vitest suite

## Requirements

- Node 18+
- `@tts-conductor/core` installed in the host workspace
- Valid ElevenLabs API key & voice ID
