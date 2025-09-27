# @tts-conductor/provider-elevenlabs

ElevenLabs provider factory for the TTS Conductor ecosystem. Creates `TtsProvider` instances backed by the official `@elevenlabs/elevenlabs-js` SDK and reuses the shared FFmpeg helpers for duration metadata.

## Usage

```ts
import { createTtsConductor, DEFAULT_PAUSE_TABLE } from '@tts-conductor/core';
import { elevenLabsProviderFactory } from '@tts-conductor/provider-elevenlabs';

const conductor = createTtsConductor({
  pauses: DEFAULT_PAUSE_TABLE,
  logger: console,
});

conductor.registerProvider(elevenLabsProviderFactory);
const provider = conductor.createProvider('11labs', {
  apiKey: process.env.ELEVENLABS_API_KEY!,
  voiceId: 'your-voice-id',
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
