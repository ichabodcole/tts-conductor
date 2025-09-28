import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsMocks = vi.hoisted(() => {
  const api = {
    writeFile: vi.fn(),
    unlink: vi.fn(),
    access: vi.fn(),
  };
  return { ...api, default: api };
});

const execaMock = vi.hoisted(() => ({
  execa: vi.fn(),
}));

vi.mock('fs/promises', () => fsMocks);
vi.mock('node:fs/promises', () => fsMocks);
vi.mock('execa', () => execaMock);
vi.mock('ffmpeg-static', () => ({
  default: '/mock/ffmpeg',
}));

let getAudioDuration: (typeof import('../utils/duration'))['getAudioDuration'];

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  ({ getAudioDuration } = await import('../utils/duration'));
});

describe('getAudioDuration', () => {
  it('returns duration from ffprobe output when available', async () => {
    const audio = Buffer.from('stub');

    fsMocks.writeFile.mockResolvedValue(undefined);
    fsMocks.unlink.mockResolvedValue(undefined);
    fsMocks.access.mockResolvedValue(undefined);
    execaMock.execa.mockResolvedValueOnce({ stdout: '1.23' });

    const duration = await getAudioDuration(audio);

    expect(duration).toBe(1.23);
    expect(execaMock.execa).toHaveBeenCalledTimes(1);
    expect(fsMocks.unlink).toHaveBeenCalled();
  });

  it('falls back to ffmpeg stderr parsing when ffprobe duration is missing', async () => {
    const audio = Buffer.from('stub');

    fsMocks.writeFile.mockResolvedValue(undefined);
    fsMocks.unlink.mockResolvedValue(undefined);
    fsMocks.access.mockImplementation(async (path) => {
      if (path === 'ffprobe' || path === '/mock/ffmpeg') return undefined;
      throw new Error('not found');
    });
    execaMock.execa
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({ stderr: 'Duration: 00:00:03.50' });

    const duration = await getAudioDuration(audio);

    expect(duration).toBe(3.5);
    expect(execaMock.execa).toHaveBeenCalledTimes(2);
    expect(execaMock.execa.mock.calls[1]?.[0]).toBe('/mock/ffmpeg');
  });

  it('estimates duration when both ffprobe and ffmpeg probing fail', async () => {
    const audio = Buffer.alloc(12800); // should fall back to estimate ≈ 0.8s
    const warn = vi.fn();

    fsMocks.writeFile.mockResolvedValue(undefined);
    fsMocks.unlink.mockResolvedValue(undefined);
    fsMocks.access.mockRejectedValue(new Error('not found'));
    execaMock.execa
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({ stderr: 'Unable to read duration' });

    const duration = await getAudioDuration(audio, undefined, { warn });

    expect(duration).toBeCloseTo(0.8, 2);
    expect(execaMock.execa).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
  });
});
