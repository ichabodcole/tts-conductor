# @tts-conductor/core

Core building blocks for text-to-speech orchestration: parsing scripts with custom pause tables, chunking to provider limits, running provider jobs with progress feedback, and assembling MP3 output via FFmpeg.

## Usage

```ts
import {
  createTtsConductor,
  DEFAULT_PAUSE_TABLE,
  ttsGenerateFull,
} from "@tts-conductor/core";

const conductor = createTtsConductor({
  pauses: DEFAULT_PAUSE_TABLE,
  logger: console,
  ffmpeg: {
    ffmpegPath: process.env.FFMPEG_PATH,
    ffprobePath: process.env.FFPROBE_PATH,
  },
});

// Instantiate the conductor once at application startup.
// Reuse this instance to register factories and create providers across your app.

const provider = conductor.createProvider("11labs", {
  /* provided by adapter */
});
const result = await conductor.generateFull("Hello world", provider);
```

All utilities (`parseScript`, `toChunks`, `buildFinalAudio`, etc.) are also exported for lower-level integration.

## Debugging

The core package includes a flexible debugging system for inspecting audio processing. Debug sinks can capture intermediate audio buffers and final assembled files for development, testing, and monitoring.

### Basic Setup

```ts
import { createTtsConductor, ProcessStage } from "@tts-conductor/core";
import type { DebugSink, DebugMeta } from "@tts-conductor/core";

class FileSystemDebugSink implements DebugSink {
  async saveBuffer(buffer: Buffer, meta: DebugMeta): Promise<void> {
    const filePath = `/debug/audio/${meta.stage}/${meta.fileName}`;
    await fs.writeFile(filePath, buffer);
    console.log(`Saved debug audio: ${filePath}`);
  }

  async saveFile(path: string, meta: DebugMeta): Promise<void> {
    const destPath = `/debug/audio/${meta.stage}/${meta.fileName}`;
    await fs.copyFile(path, destPath);
    console.log(`Copied debug file: ${destPath}`);
  }
}

const conductor = createTtsConductor({
  pauses: DEFAULT_PAUSE_TABLE,
  debug: new FileSystemDebugSink(), // Enable debug output
});
```

### Debug Metadata

Debug sinks receive rich metadata with each audio output:

```typescript
enum ProcessStage {
  Raw = "raw", // Individual audio chunks from providers
  Final = "final", // Final assembled audio after stitching
  Unknown = "unknown", // Fallback stage when not specified
}

interface DebugMeta {
  fileName: string; // Descriptive filename (e.g., "raw_11labs_0_123456789.mp3")
  jobId?: string; // Optional correlation ID from consuming project
  stage: ProcessStage | string; // Processing stage
  [key: string]: unknown; // Custom metadata from providers/projects
}
```

**Standard Stages:**

- `'raw'` - Individual audio chunks from providers
- `'final'` - Final assembled audio after stitching
- `'unknown'` - Fallback stage when not specified by caller

### Advanced Usage

```ts
// Projects can add custom correlation and metadata
await conductor.generateFull(text, provider, progress, {
  debugJobId: "user-session-123", // Correlate all debug outputs for this job
});

// Debug sinks can use metadata for organization
class DatabaseDebugSink implements DebugSink {
  async saveBuffer(buffer: Buffer, meta: DebugMeta): Promise<void> {
    await db.audioDebug.create({
      jobId: meta.jobId,
      stage: meta.stage,
      fileName: meta.fileName,
      size: buffer.length,
      customField: meta.customField, // Access custom metadata
    });
  }

  async saveFile(path: string, meta: DebugMeta): Promise<void> {
    // Implementation for file saving
  }
}
```

### Provider-Level Debugging

Providers can add their own debug metadata:

```ts
// Inside a provider's generate method
await saveDebugFromBuffer(config, audioBuffer, {
  stage: ProcessStage.Raw, // Use enum for type safety
  providerName: "elevenlabs",
  voiceId: "voice-123",
  latency: 250,
  requestId: "req-456",
});
```

Debug output is **completely opt-in** - if no debug sink is configured, there's zero performance overhead.

### Async-safety inside debug sinks

`saveBuffer` and `saveFile` are awaited inside the orchestration loop. If your
sink does blocking I/O (S3 upload, remote logging, database round-trip), every
chunk pays that latency before the next chunk starts — total job time grows by
`chunks × sink_latency`.

If you can tolerate eventual-consistency on debug output (almost always true
for inspection sinks), fire-and-forget the side effect and return immediately:

```ts
class S3DebugSink implements DebugSink {
  async saveBuffer(buffer: Buffer, meta: DebugMeta): Promise<void> {
    // Don't await — let the upload race in the background.
    void s3
      .upload({ Bucket: "debug", Key: meta.fileName, Body: buffer })
      .promise()
      .catch((err) => console.error("[debug] s3 upload failed", err));
  }
  async saveFile(path: string, meta: DebugMeta): Promise<void> {
    void (
      s3
        .upload({
          /* ... */
        })
        .promise()
        .catch(/* ... */)
    );
  }
}
```

The library does not enforce this — sinks that genuinely need synchronous
durability (test recorders, deterministic snapshots) are free to await. Just
know the cost.

## Progress reporting and BullMQ heartbeats

Both `onProgress(percent)` and the richer `onEvent(...)` lifecycle callback
fire from the orchestration loop. The simplest BullMQ integration is to use
`onProgress` directly as the job's heartbeat — long jobs that don't tick
progress will get killed by BullMQ's stall detection:

```ts
// In your BullMQ processor
await conductor.generateFull(
  job.data.script,
  provider,
  (pct) => job.updateProgress(pct), // doubles as heartbeat
  { signal: job.abortSignal },
);
```

For richer per-stage updates (e.g., emitting structured events to a UI),
subscribe to `onEvent` as well — both callbacks coexist and fire
independently. See the `TtsEvent` discriminated union for the exact shape
(parse-complete, chunk-start, chunk-complete, stitch-start, stitch-complete).

## Script parsing behavior

`parseScript` performs two small automatic fixups across pause-marker boundaries to make hand-authored scripts sound natural when narrated:

- **Dashes lead, not trail.** A trailing em/en/hyphen on the segment before a `[PAUSE:...]` marker is moved to the start of the segment after it. `"...the answer is— [PAUSE:LONG] no, it isn't."` becomes `"...the answer is"` / `"— no, it isn't."`. TTS engines render this with the dash pause grouped with the resumed clause, which matches how the line actually reads aloud.
- **Leading punctuation attaches backward.** Stray punctuation (`.,!?:;…")']`) at the start of the segment after a pause is moved to the end of the segment before it. `"hello [PAUSE:SHORT] , world"` becomes `"hello,"` / `"world"`. This keeps prosody markers (commas, periods) attached to the preceding clause where they belong.

Both fixups only operate on `text → pause → text` triples. Pauses at the start or end of the script, and back-to-back pauses, are left alone. The behavior is unconditional — if you need the raw split, work with the segments returned by `parseScript` before they reach `toChunks`.

## Inline pause rendering (provider extensibility)

The core falls back to standard SSML `<break time="${seconds}s" />` when a provider doesn't supply a custom `renderInlineBreak`. This is **load-bearing for non-SSML engines** — adapters for engines that use a different inline-pause syntax (mark tags, speech markdown, etc.) supply their own renderer through `caps.renderInlineBreak`, and the core defers to it inside `toChunks`. Don't inline the SSML literal anywhere outside the fallback; future adapters depend on this being the only override point.

### Provider integration

Every provider factory must expose `caps: ProviderCapabilities`. In addition to limits such as `maxInlineBreakSeconds` and `maxCharsPerRequest`, you can now supply `renderInlineBreak(seconds)` when the target engine expects a custom inline pause tag (for example, `<mark name="pause:${seconds}"/>`). If omitted, the core falls back to SSML `<break time="${seconds}s" />` markup. Providers that cannot inline pauses should set `maxInlineBreakSeconds` to `null`.

Factory implementations receive the runtime context (`TtsProviderContext`) so they can access shared config such as pause tables, loggers, or ffmpeg paths. Return objects must fulfil the `TtsProvider` contract by implementing `generate(chunk)` and reporting `caps`.

#### Type Safety

The conductor provides type-safe provider registration via module augmentation. Provider packages can register their option types to get full IntelliSense support and compile-time validation.

#### Minimal custom factory

```ts
import type { TtsProviderFactory } from "@tts-conductor/core";

// Define your provider options interface
interface DemoProviderOptions {
  apiUrl: string;
}

// Register your provider type (enables type-safe usage)
declare module "@tts-conductor/core" {
  interface TtsProviderRegistry {
    demo: DemoProviderOptions;
  }
}

// Create a typed factory - the conductor will enforce correct option types
export const demoProviderFactory: TtsProviderFactory<"demo"> = {
  id: "demo",
  create(ctx, options) {
    return {
      id: ctx.id,
      caps: {
        maxInlineBreakSeconds: null,
        maxCharsPerRequest: 500,
      },
      async generate(chunk) {
        const response = await fetch(options.apiUrl, {
          method: "POST",
          body: chunk,
        });
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
const provider = conductor.createProvider("demo", {
  apiUrl: "https://example.com/tts",
  // TypeScript enforces correct options ✅
});
```

## Scripts

- `bun run build` – compile sources to `dist/`
- `bun run dev` – rebuild on change
- `bun run lint` – run Biome over `src/`
- `bun run test` – run Vitest suite

## Requirements

- Node 18+
- FFmpeg/FFprobe available on the host (override paths via `ffmpeg` config options)
