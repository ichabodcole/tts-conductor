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

// Instantiate the conductor once at application startup.
// Reuse this instance to register factories and create providers across your app.

const provider = conductor.createProvider('11labs', {
  /* provided by adapter */
});
const result = await conductor.generateFull('Hello world', provider);
```

All utilities (`parseScript`, `toChunks`, `buildFinalAudio`, etc.) are also exported for lower-level integration.

### Provider integration

Every provider factory must expose `caps: ProviderCapabilities`. In addition to limits such as `maxInlineBreakSeconds` and `maxCharsPerRequest`, you can now supply `renderInlineBreak(seconds)` when the target engine expects a custom inline pause tag (for example, `<mark name="pause:${seconds}"/>`). If omitted, the core falls back to SSML `<break time="${seconds}s" />` markup. Providers that cannot inline pauses should set `maxInlineBreakSeconds` to `null`.

Factory implementations receive the runtime context (`TtsProviderContext`) so they can access shared config such as pause tables, loggers, or ffmpeg paths. Return objects must fulfil the `TtsProvider` contract by implementing `generate(chunk)` and reporting `caps`.

#### Type Safety

The conductor provides type-safe provider registration via module augmentation. Provider packages can register their option types to get full IntelliSense support and compile-time validation.

#### Minimal custom factory

```ts
import type { TtsProviderFactory } from '@tts-conductor/core';

// Define your provider options interface
interface DemoProviderOptions {
  apiUrl: string;
}

// Register your provider type (enables type-safe usage)
declare module '@tts-conductor/core' {
  interface TtsProviderRegistry {
    demo: DemoProviderOptions;
  }
}

// Create a typed factory - the conductor will enforce correct option types
export const demoProviderFactory: TtsProviderFactory<'demo'> = {
  id: 'demo',
  create(ctx, options) {
    return {
      id: ctx.id,
      caps: {
        maxInlineBreakSeconds: null,
        maxCharsPerRequest: 500,
      },
      async generate(chunk) {
        const response = await fetch(options.apiUrl, { method: 'POST', body: chunk });
        const audio = Buffer.from(await response.arrayBuffer());
        // duration, mimeType, and size are optional - supply them if available
        return { audio };
      },
    };
  },
};
```

Register factories once during startup, then create configured instances as needed:

```ts
// Register the factory
const demoId = conductor.registerProvider(demoProviderFactory);

// Create a provider instance with type-safe options
const provider = conductor.createProvider('demo', {
  apiUrl: 'https://example.com/tts',
  // TypeScript enforces correct options ✅
});
```

## Scripts

- `pnpm build` – compile sources to `dist/`
- `pnpm dev` – rebuild on change
- `pnpm lint` – run ESLint over `src/`
- `pnpm test` – run Vitest suite (tests TBD)

## Requirements

- Node 18+
- FFmpeg/FFprobe available on the host (override paths via `ffmpeg` config options)
