# @tts-conductor/provider-elevenlabs

ElevenLabs provider factory for the TTS Conductor ecosystem. Creates `TtsProvider` instances backed by the official `@elevenlabs/elevenlabs-js` SDK and reuses the shared FFmpeg helpers for duration metadata.

## Usage

```ts
import { createTtsConductor, DEFAULT_PAUSE_TABLE } from '@tts-conductor/core';
import { elevenLabsProviderFactory } from '@tts-conductor/provider-elevenlabs';

// Instantiate the conductor once at application startup.
const conductor = createTtsConductor({
  pauses: DEFAULT_PAUSE_TABLE,
  logger: console,
});

// Register the factory once so the conductor knows how to build ElevenLabs providers.
const elevenLabsId = conductor.registerProvider(elevenLabsProviderFactory);

// Create a configured provider instance when you need to generate audio.
// TypeScript enforces correct option types for '11labs' provider
const provider = conductor.createProvider('11labs', {
  apiKey: process.env.ELEVENLABS_API_KEY!,
  voiceId: 'your-voice-id',
  quality: 'standard', // ✅ TypeScript validates this
  voiceSettings: {
    stability: 0.5,
    similarity_boost: 0.8,
  },
});

const result = await conductor.generateFull('Hello world', provider);
```

## Scripts

- `pnpm build` – compile sources to `dist/`
- `pnpm dev` – rebuild on change
- `pnpm lint` – run ESLint over `src/`
- `pnpm test` – run Vitest suite (tests TBD)

## Requirements

- Node 18+
- `@tts-conductor/core` installed in the host workspace
- Valid ElevenLabs API key & voice ID
