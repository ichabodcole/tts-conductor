import { execa } from 'execa';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Chunk } from '../utils/chunker';

const defaultExecaImpl = vi.hoisted(() => async (_cmd: string | URL, args?: readonly string[]) => {
  const list = Array.isArray(args) ? [...args] : [];
  const flagIndex = list.lastIndexOf('-y');
  const outPath = flagIndex >= 0 ? list[flagIndex + 1] : undefined;
  if (outPath) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(outPath, Buffer.from('stub'));
  }
  return { stdout: '', stderr: '' };
});

vi.mock('execa', () => {
  const mockFn = vi.fn(defaultExecaImpl as unknown as typeof execa);
  return { execa: mockFn };
});

type ExecaMock = ReturnType<typeof vi.fn>;

const getExecaMock = () => vi.mocked(execa) as unknown as ExecaMock;

vi.mock('../utils/debug', () => ({
  saveDebugFromFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('ffmpeg-static', () => ({
  default: '/usr/bin/ffmpeg',
}));

const config = {
  pauses: {},
  logger: {
    info: () => {},
    debug: () => {},
    warn: () => {},
  },
};

let buildFinalAudio: typeof import('../utils/stitcher')['buildFinalAudio'];

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  ({ buildFinalAudio } = await import('../utils/stitcher'));
  getExecaMock().mockImplementation(defaultExecaImpl as unknown as typeof execa);
});

describe('buildFinalAudio', () => {
  it('throws when chunk and audio arrays differ', async () => {
    await expect(
      buildFinalAudio(config, [], [{ buffer: Buffer.alloc(0), duration: 0 }]),
    ).rejects.toThrowError('chunks and audio arrays must be equal length');
  });

  it('returns a Buffer payload when ffmpeg succeeds', async () => {
    const chunks: Chunk[] = [{ ssml: 'Hello', postPause: 0 }];
    const audio = [{ buffer: Buffer.from('hello'), duration: 1 }];
    const result = await buildFinalAudio(config, chunks, audio, 'test.mp3');
    expect(result.mimeType).toBe('audio/mpeg');
    expect(Buffer.isBuffer(result.audio)).toBe(true);
    expect(result.audio.length).toBeGreaterThan(0);
    expect(result.size).toBe(result.audio.length);
    expect(getExecaMock()).toHaveBeenCalled();
  });

  it('still exposes base64Data alongside the Buffer for backcompat', async () => {
    const chunks: Chunk[] = [{ ssml: 'Hello', postPause: 0 }];
    const audio = [{ buffer: Buffer.from('hello'), duration: 1 }];
    const result = await buildFinalAudio(config, chunks, audio, 'test.mp3');
    expect(result.base64Data).toBe(result.audio.toString('base64'));
  });

  it('throws AbortError immediately when given a pre-aborted signal (A3)', async () => {
    const chunks: Chunk[] = [{ ssml: 'Hello', postPause: 0 }];
    const audio = [{ buffer: Buffer.from('hello'), duration: 1 }];
    const controller = new AbortController();
    controller.abort();

    await expect(
      buildFinalAudio(config, chunks, audio, 'test.mp3', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });

    // Critical: no ffmpeg spawn should have happened — we bailed before
    // resolving the binary or writing any temp files.
    expect(getExecaMock()).not.toHaveBeenCalled();
  });

  it('forwards cancelSignal to every execa call (A3)', async () => {
    const chunks: Chunk[] = [{ ssml: 'Hello', postPause: 0 }];
    const audio = [{ buffer: Buffer.from('hello'), duration: 1 }];
    const controller = new AbortController();

    await buildFinalAudio(config, chunks, audio, 'test.mp3', { signal: controller.signal });

    // Every execa call should carry the signal as its cancelSignal option.
    const calls = getExecaMock().mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [, , options] of calls) {
      expect(options).toMatchObject({ cancelSignal: controller.signal });
    }
  });

  it('uses DEFAULT_TIMEOUTS when config.timeouts is omitted (config sweep)', async () => {
    const chunks: Chunk[] = [{ ssml: 'Hello', postPause: 0 }];
    const audio = [{ buffer: Buffer.from('hello'), duration: 1 }];

    await buildFinalAudio(config, chunks, audio, 'test.mp3');

    // Pulls every execa's timeout option and checks they match the documented
    // defaults. Catches drift if DEFAULT_TIMEOUTS values are accidentally changed.
    const calls = getExecaMock().mock.calls;
    const timeouts = calls.map((c) => (c[2] as { timeout?: number } | undefined)?.timeout);
    // Expected timeouts in order: transcode (30s), concat (45s), finalEncode (45s).
    expect(timeouts).toEqual([30_000, 45_000, 45_000]);
  });

  it('uses config.timeouts overrides when supplied (config sweep)', async () => {
    const chunks: Chunk[] = [{ ssml: 'Hello', postPause: 0 }];
    const audio = [{ buffer: Buffer.from('hello'), duration: 1 }];
    const customConfig = {
      ...config,
      timeouts: { transcode: 7_777, concat: 8_888, finalEncode: 9_999 },
    };

    await buildFinalAudio(customConfig, chunks, audio, 'test.mp3');

    const calls = getExecaMock().mock.calls;
    const timeouts = calls.map((c) => (c[2] as { timeout?: number } | undefined)?.timeout);
    expect(timeouts).toEqual([7_777, 8_888, 9_999]);
  });

  it('falls back to DEFAULT_TIMEOUTS for any field not overridden (partial override)', async () => {
    const chunks: Chunk[] = [{ ssml: 'Hello', postPause: 0 }];
    const audio = [{ buffer: Buffer.from('hello'), duration: 1 }];
    // Override only `transcode`. concat and finalEncode must still pull from
    // DEFAULT_TIMEOUTS — guards against a regression where partial overrides
    // accidentally zero out the rest (e.g., if merge-once order flipped).
    const customConfig = { ...config, timeouts: { transcode: 4_242 } };

    await buildFinalAudio(customConfig, chunks, audio, 'test.mp3');

    const calls = getExecaMock().mock.calls;
    const timeouts = calls.map((c) => (c[2] as { timeout?: number } | undefined)?.timeout);
    // transcode=4242 (override), concat=45000 (default), finalEncode=45000 (default)
    expect(timeouts).toEqual([4_242, 45_000, 45_000]);
  });

  it('includes -ac in the final encode args so DEFAULT_OUTPUT_FORMAT.channels is honored', async () => {
    const chunks: Chunk[] = [{ ssml: 'Hello', postPause: 0 }];
    const audio = [{ buffer: Buffer.from('hello'), duration: 1 }];

    await buildFinalAudio(config, chunks, audio, 'test.mp3');

    // The last execa call is the final MP3 encode. Verify -ac is present
    // alongside -ar and -b:a so DEFAULT_OUTPUT_FORMAT.channels is actually
    // forwarded to ffmpeg (regression guard for the post-review fix).
    const calls = getExecaMock().mock.calls;
    const finalCall = calls[calls.length - 1];
    const args = (finalCall?.[1] as string[]) ?? [];
    expect(args).toContain('-ac');
  });

  it('reuses cached silence files for identical pause durations', async () => {
    const chunks: Chunk[] = [
      { ssml: 'Hello', postPause: 2 },
      { ssml: 'World', postPause: 2 },
    ];
    const audio = [
      { buffer: Buffer.from('a'), duration: 1 },
      { buffer: Buffer.from('b'), duration: 1 },
    ];

    await buildFinalAudio(config, chunks, audio, 'cache.mp3');

    const silenceCalls = getExecaMock().mock.calls.filter((call: unknown[]) => {
      const args = call[1];
      return (
        Array.isArray(args) &&
        args.some((arg) => typeof arg === 'string' && arg.includes('anullsrc'))
      );
    });
    expect(silenceCalls).toHaveLength(1);
  });

  it('falls back to filter concat when concat demuxer fails', async () => {
    const execaMock = getExecaMock();
    execaMock.mockImplementation(async (_cmd: string | URL, args?: readonly string[]) => {
      const list = Array.isArray(args) ? [...args] : [];
      const isConcatDemux =
        list.includes('-f') && list.includes('concat') && !list.includes('-filter_complex');
      if (isConcatDemux) {
        throw new Error('concat demuxer failed');
      }
      const flagIndex = list.lastIndexOf('-y');
      const outPath = flagIndex >= 0 ? list[flagIndex + 1] : undefined;
      if (outPath) {
        const { writeFile } = await import('node:fs/promises');
        await writeFile(outPath, Buffer.from('stub'));
      }
      return { stdout: '', stderr: '' };
    });

    const chunks: Chunk[] = [{ ssml: 'One', postPause: 0 }];
    const audio = [{ buffer: Buffer.from('one'), duration: 1 }];

    await buildFinalAudio(config, chunks, audio, 'fallback.mp3');

    const filterCalls = execaMock.mock.calls.filter((call: unknown[]) => {
      const args = call[1];
      return Array.isArray(args) && args.includes('-filter_complex');
    });
    expect(filterCalls.length).toBeGreaterThan(0);
  });
});
