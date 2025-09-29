# TTS Interface Alignment

**Status:** ✅ Completed (2025-09-29)

## Context

The integration between `@tts-conductor/core` and the ElevenLabs provider surfaced a few design issues in the shared interfaces. Addressing these will reduce duplicated effort for provider implementations and improve traceability inside the core pipeline.

## Proposed Changes

### 1. Respect Provider-Supplied Durations

- **Problem:** `ElevenLabsProvider.generate` already computes audio duration (`packages/tts-provider-elevenlabs/src/elevenLabsProvider.ts:81`), but `ttsGenerateFull` recomputes it for every chunk (`packages/tts-core/src/operations.ts:55`). The second ffmpeg call doubles work and latency.
- **Proposal:** Allow providers to supply `duration` and `size`, and have the core trust those values when present. Only fall back to `getAudioDuration` if they are undefined. Alternatively, remove these fields from `GenerationResult` so providers skip the redundant computation—choose one consistent strategy.

### 2. Formalize Provider Identity

- **Problem:** The core tries to log a provider id via `(provider as { id?: string }).id` (`packages/tts-core/src/operations.ts:32`), but `TtsProvider` lacks an `id` contract and the ElevenLabs factory never assigns one. Logs therefore use the generic label `"provider"`, reducing observability.
- **Proposal:** Extend `TtsProvider` with a required `id: RegisteredProviderIds` (or similar) and have factories stamp that onto returned instances. This keeps logging strongly typed and useful, and avoids unsafe casts.

### 3. Trim Extraneous Metadata Requirements

- **Problem:** `GenerationResult` makes `mimeType`, `duration`, and `size` mandatory even though the core currently ignores everything except the buffer and recomputes duration/size. This obligates providers to populate fields that may not be needed. The operations test inadvertently documents this issue by returning `duration: 0` in mock results (`packages/tts-core/src/__tests__/operations.test.ts:70`), which would be meaningless in production but doesn't matter since the core discards it.
- **Proposal:** If the core will start trusting provider metadata (see Proposal #1), keep the fields but mark them optional so adapters opt in. Otherwise, drop unused fields to keep the interface minimal and focused.

### 4. Propagate Provider ID via Context

- **Problem:** While factories have an `id` field, it's never transferred to the provider instances they create. This forces the core to use unsafe casts when logging and prevents providers from self-identifying. Requiring providers to manually store the id during construction is error-prone and duplicates data already known at creation time.
- **Proposal:** Extend `TtsProviderContext` to include `id: string`, and have `conductor.createProvider` populate it from `factory.id` before calling `factory.create`. Then add `readonly id: string` to the `TtsProvider` interface. Providers can simply assign `this.id = ctx.id` in their constructors, ensuring the id flows through the entire lifecycle without unsafe casts or manual duplication.

## Implementation Details

### Decisions

1. **Duration/Size Strategy:** Trust provider-supplied values when present, fall back to ffprobe only when undefined. This gives providers flexibility to optimize while maintaining backward compatibility.
2. **Metadata Fields:** Make `mimeType`, `duration`, and `size` optional in `GenerationResult`. Providers can opt into supplying them.
3. **Provider ID Type:** Use `string` at the instance level. The factory's `id` is already strongly typed as `RegisteredProviderIds`, and it flows through to the provider via context.

### Interface Changes

#### Before

```typescript
// packages/tts-core/src/factory.ts
export interface TtsProviderContext {
  config: TtsRuntimeConfig;
}

// packages/tts-core/src/provider.ts
export interface TtsProvider {
  readonly caps: ProviderCapabilities;
  generate(chunk: string): Promise<GenerationResult>;
}

export interface GenerationResult {
  audio: Buffer;
  mimeType: string;
  duration: number;
  size: number;
}
```

#### After

```typescript
// packages/tts-core/src/factory.ts
export interface TtsProviderContext {
  config: TtsRuntimeConfig;
  id: string;
}

// packages/tts-core/src/provider.ts
export interface TtsProvider {
  readonly id: string;
  readonly caps: ProviderCapabilities;
  generate(chunk: string): Promise<GenerationResult>;
}

export interface GenerationResult {
  audio: Buffer;
  mimeType?: string;
  duration?: number;
  size?: number;
}
```

### Code Changes

#### 1. Update `conductor.createProvider` to populate context ID

```typescript
// packages/tts-core/src/conductor.ts:60
createProvider<T extends RegisteredProviderIds>(
  id: T,
  options: ProviderOptionsFor<T>,
): TtsProvider {
  const factory = this.providers.get(id);
  if (!factory) {
    throw new Error(`Provider '${id}' is not registered`);
  }
  this.config.logger?.info?.('Creating provider instance', id, { options });
  // ✏️ Change this line:
  return factory.create({ config: this.config, id: factory.id }, options);
}
```

#### 2. Update `ttsGenerateFull` to trust provider metadata

```typescript
// packages/tts-core/src/operations.ts:32-56
export async function ttsGenerateFull(
  rawText: string,
  provider: TtsProvider,
  config: TtsRuntimeConfig,
  onProgress?: (percent: number) => void,
  options?: BuildAudioOptions,
): Promise<BuildFinalAudioResult> {
  const logger = config.logger;
  // ✏️ Remove unsafe cast, use provider.id directly:
  const providerId = provider.id;

  const segments = parseScript(rawText, config.pauses, logger);
  logger?.info?.('[tts] Parsed segments', { count: segments.length });

  const chunks = toChunks(segments, provider.caps, logger);
  logger?.info?.('[tts] Generated chunks', { count: chunks.length });

  const audioParts: { buffer: Buffer; duration: number }[] = [];
  let done = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i] as Chunk;
    const input = `<speak>${chunk.ssml}</speak>`;
    logger?.debug?.('[tts] Generating chunk', {
      provider: providerId,
      index: i,
      postPause: chunk.postPause,
    });

    onProgress?.(Math.min(10, Math.round(((i + 1) / chunks.length) * 10)));

    const res = await withTimeout(provider.generate(input), 60000, `provider.generate chunk ${i}`);

    // ✏️ Trust provider duration if supplied, otherwise compute it:
    const duration = res.duration ?? (await getAudioDuration(res.audio, config.ffmpeg, logger));

    audioParts.push({ buffer: res.audio, duration });
    done++;

    await saveDebugFromBuffer(config, res.audio, {
      fileName: `raw_${providerId}_${i}_${Date.now()}.mp3`,
      jobId: options?.debugJobId,
      stage: 'raw',
    });

    const chunkProgress = Math.round((done / chunks.length) * 80);
    onProgress?.(chunkProgress);
  }

  onProgress?.(80);
  const final = await withTimeout(
    buildFinalAudio(config, chunks, audioParts, undefined, options),
    45000,
    'stitcher.buildFinalAudio',
  );
  onProgress?.(100);

  return final;
}
```

#### 3. Update ElevenLabs Provider

```typescript
// packages/tts-provider-elevenlabs/src/elevenLabsProvider.ts

class ElevenLabsProvider implements TtsProvider {
  readonly id: string;
  readonly caps = CAPS;
  private client: ElevenLabsClient;

  constructor(
    private readonly ctx: TtsProviderContext,
    private readonly options: ElevenLabsProviderOptions,
  ) {
    // ✏️ Add this line:
    this.id = ctx.id;
    this.client = new ElevenLabsClient({ apiKey: options.apiKey });
  }

  async generate(chunk: string): Promise<GenerationResult> {
    const { voiceId, quality = 'standard', voiceSettings } = this.options;
    const logger = this.ctx.config.logger;

    // ... existing conversion logic ...

    try {
      const audioStream = await this.client.textToSpeech.convert(voiceId, convertOptions);
      const buffer = await streamToBuffer(audioStream);

      logger?.info?.('[11labs] convert done', { bytes: buffer.length });

      const duration = await getAudioDuration(buffer, this.ctx.config.ffmpeg, logger);
      logger?.info?.('[11labs] duration', { duration });

      return {
        audio: buffer,
        mimeType: 'audio/mpeg',
        duration,
        size: buffer.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.error?.('[11labs] generation error', { message });
      throw new Error(`ElevenLabs generation failed: ${message}`);
    }
  }
}
```

### Test Updates

#### Update operations.test.ts mock to supply duration

```typescript
// packages/tts-core/src/__tests__/operations.test.ts:66-74

beforeEach(() => {
  provider = {
    id: 'test-provider', // ✏️ Add id
    caps: { maxInlineBreakSeconds: 3, maxCharsPerRequest: 100 },
    async generate() {
      return {
        audio: Buffer.from('fake'),
        mimeType: 'audio/mpeg',
        duration: 1.25, // ✏️ Supply realistic duration
        size: 4,
      } satisfies GenerationResult;
    },
  } satisfies TtsProvider;
});
```

#### Add test to verify provider duration is trusted

```typescript
// packages/tts-core/src/__tests__/operations.test.ts (new test)

it('trusts provider-supplied duration without calling ffprobe', async () => {
  const providerWithDuration: TtsProvider = {
    id: 'fast-provider',
    caps: provider.caps,
    async generate() {
      return {
        audio: Buffer.from('fake'),
        duration: 2.5, // Provider supplies duration
      };
    },
  };

  await ttsGenerateFull('Hello', providerWithDuration, runtimeConfig);

  // ffprobe should NOT be called since provider supplied duration
  expect(getAudioDurationMock).not.toHaveBeenCalled();
});

it('falls back to ffprobe when provider omits duration', async () => {
  const providerWithoutDuration: TtsProvider = {
    id: 'minimal-provider',
    caps: provider.caps,
    async generate() {
      return {
        audio: Buffer.from('fake'),
        // No duration supplied
      };
    },
  };

  await ttsGenerateFull('Hello', providerWithoutDuration, runtimeConfig);

  // ffprobe SHOULD be called as fallback
  expect(getAudioDurationMock).toHaveBeenCalledWith(
    expect.any(Buffer),
    runtimeConfig.ffmpeg,
    runtimeConfig.logger,
  );
});
```

### Acceptance Criteria

1. ✅ `TtsProviderContext` includes `id: string`
2. ✅ `TtsProvider` interface includes `readonly id: string`
3. ✅ `GenerationResult` fields `mimeType`, `duration`, `size` are optional
4. ✅ `conductor.createProvider` passes `id` in context
5. ✅ `operations.ts` uses `provider.id` instead of unsafe cast
6. ✅ `operations.ts` trusts `res.duration` when present, only calls `getAudioDuration` when undefined
7. ✅ ElevenLabs provider assigns `this.id = ctx.id` in constructor
8. ✅ Tests verify duration is trusted when supplied by provider
9. ✅ Tests verify fallback to ffprobe when provider omits duration
10. ✅ All existing tests pass with updated interfaces

### Validation

Run the following to verify the changes:

```bash
# All tests should pass
pnpm test

# Type checking should pass
pnpm --filter @tts-conductor/core build
pnpm --filter @tts-conductor/tts-provider-elevenlabs build

# Coverage should show operations.ts trusts provider duration
pnpm test --coverage
```

Expected outcome: For a provider that supplies `duration`, `getAudioDuration` should show 0 invocations in that test case.

## Next Steps

1. Update `TtsProviderContext` to include `id: string`
2. Update `TtsProvider` interface to include `readonly id: string`
3. Make `GenerationResult` fields optional (`mimeType?`, `duration?`, `size?`)
4. Modify `conductor.createProvider` to pass `id` in context
5. Update `operations.ts` to use `provider.id` and trust provider-supplied duration
6. Update ElevenLabs provider to assign `this.id = ctx.id`
7. Update all test mocks to include `id` field
8. Add tests for duration trust/fallback behavior
9. Verify no ffprobe duplication in integration tests
