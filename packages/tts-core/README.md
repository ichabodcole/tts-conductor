# @tts-conductor/core

Core building blocks for text-to-speech orchestration: parsing scripts with custom pause tables, chunking to provider limits, running provider jobs with progress feedback, and assembling MP3 output via FFmpeg.

## Usage

```ts
import { createTtsConductor, DEFAULT_PAUSE_TABLE, ttsGenerateFull } from '@tts-conductor/core';

const conductor = createTtsConductor({
  pauses: DEFAULT_PAUSE_TABLE,
  logger: console,
  ffmpeg: { ffmpegPath: process.env.FFMPEG_PATH, ffprobePath: process.env.FFPROBE_PATH },
});

const provider = conductor.createProvider('11labs', {
  /* provided by adapter */
});
const result = await conductor.generateFull('Hello world', provider);
```

All utilities (`parseScript`, `toChunks`, `buildFinalAudio`, etc.) are also exported for lower-level integration.

### Provider integration

Every provider factory must expose `caps: ProviderCapabilities`. In addition to limits such as `maxInlineBreakSeconds` and `maxCharsPerRequest`, you can now supply `renderInlineBreak(seconds)` when the target engine expects a custom inline pause tag (for example, `<mark name="pause:${seconds}"/>`). If omitted, the core falls back to SSML `<break time="${seconds}s" />` markup. Providers that cannot inline pauses should set `maxInlineBreakSeconds` to `null`.

Factory implementations receive the runtime context (`TtsProviderContext`) so they can access shared config such as pause tables, loggers, or ffmpeg paths. Return objects must fulfil the `TtsProvider` contract by implementing `generate(chunk)` and reporting `caps`.

## Scripts

- `pnpm build` – compile sources to `dist/`
- `pnpm dev` – rebuild on change
- `pnpm lint` – run ESLint over `src/`
- `pnpm test` – run Vitest suite (tests TBD)

## Requirements

- Node 18+
- FFmpeg/FFprobe available on the host (override paths via `ffmpeg` config options)
