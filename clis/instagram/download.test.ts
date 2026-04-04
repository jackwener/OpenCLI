import * as os from 'node:os';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CliCommand } from '../../registry.js';
import { getRegistry } from '../../registry.js';
import { ArgumentError, AuthRequiredError, CliError, CommandExecutionError } from '../../errors.js';
import type { IPage } from '../../types.js';

const { mockHttpDownload, logSpy } = vi.hoisted(() => ({
  mockHttpDownload: vi.fn(),
  logSpy: vi.spyOn(console, 'log').mockImplementation(() => undefined),
}));

vi.mock('../../download/index.js', async () => {
  const actual = await vi.importActual<object>('../../download/index.js');
  return { ...actual, httpDownload: mockHttpDownload };
});

const {
  buildInstagramDownloadItems,
  parseInstagramMediaTarget,
} = await import('./download.js');

let cmd: CliCommand;

beforeAll(() => {
  cmd = getRegistry().get('instagram/download')!;
  expect(cmd?.func).toBeTypeOf('function');
});

function createPageMock(evaluateResult: unknown): IPage {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(evaluateResult),
  } as unknown as IPage;
}

describe('instagram download helpers', () => {
  it('parses canonical and username-prefixed Instagram media URLs', () => {
    expect(parseInstagramMediaTarget('https://www.instagram.com/reel/DWg8NuZEj9p/?utm_source=ig_web_copy_link')).toEqual({
      kind: 'reel',
      shortcode: 'DWg8NuZEj9p',
      canonicalUrl: 'https://www.instagram.com/reel/DWg8NuZEj9p/',
    });

    expect(parseInstagramMediaTarget('https://www.instagram.com/nasa/p/DWUR_azCWbN/?img_index=1')).toEqual({
      kind: 'p',
      shortcode: 'DWUR_azCWbN',
      canonicalUrl: 'https://www.instagram.com/p/DWUR_azCWbN/',
    });
  });

  it('rejects unsupported URLs early', () => {
    expect(() => parseInstagramMediaTarget('https://example.com/p/abc')).toThrow(ArgumentError);
    expect(() => parseInstagramMediaTarget('https://www.instagram.com/stories/abc/123')).toThrow(ArgumentError);
  });

  it('builds padded filenames and preserves known file extensions', () => {
    expect(buildInstagramDownloadItems('DWUR_azCWbN', [
      { type: 'image', url: 'https://cdn.example.com/photo.webp?foo=1' },
      { type: 'video', url: 'https://cdn.example.com/video.mp4?bar=2' },
      { type: 'image', url: 'not-a-valid-url' },
    ])).toEqual([
      { type: 'image', url: 'https://cdn.example.com/photo.webp?foo=1', filename: 'DWUR_azCWbN_01.webp' },
      { type: 'video', url: 'https://cdn.example.com/video.mp4?bar=2', filename: 'DWUR_azCWbN_02.mp4' },
      { type: 'image', url: 'not-a-valid-url', filename: 'DWUR_azCWbN_03.jpg' },
    ]);
  });
});

describe('instagram download command', () => {
  beforeEach(() => {
    mockHttpDownload.mockReset();
    logSpy.mockClear();
  });

  it('rejects invalid URLs before browser work', async () => {
    const page = createPageMock({ ok: true, items: [] });
    await expect(cmd.func!(page, { url: 'https://example.com/not-instagram' })).rejects.toThrow(ArgumentError);
    expect((page.goto as any).mock.calls).toHaveLength(0);
  });

  it('maps auth failures to AuthRequiredError', async () => {
    const page = createPageMock({ ok: false, errorCode: 'AUTH_REQUIRED', error: 'Instagram login required' });
    await expect(cmd.func!(page, { url: 'https://www.instagram.com/p/DWUR_azCWbN/' })).rejects.toThrow(AuthRequiredError);
    expect(mockHttpDownload).not.toHaveBeenCalled();
  });

  it('maps rate limit failures to CliError with RATE_LIMITED code', async () => {
    const page = createPageMock({ ok: false, errorCode: 'RATE_LIMITED', error: 'Please wait a few minutes' });
    await expect(cmd.func!(page, { url: 'https://www.instagram.com/p/DWUR_azCWbN/' })).rejects.toMatchObject({ code: 'RATE_LIMITED' } satisfies Partial<CliError>);
    expect(mockHttpDownload).not.toHaveBeenCalled();
  });

  it('maps private/unavailable failures to CommandExecutionError', async () => {
    const page = createPageMock({ ok: false, errorCode: 'PRIVATE_OR_UNAVAILABLE', error: 'Post may be private' });
    await expect(cmd.func!(page, { url: 'https://www.instagram.com/p/DWUR_azCWbN/' })).rejects.toThrow(CommandExecutionError);
    expect(mockHttpDownload).not.toHaveBeenCalled();
  });

  it('throws when no downloadable media is found', async () => {
    const page = createPageMock({ ok: true, shortcode: 'DWUR_azCWbN', items: [] });
    await expect(cmd.func!(page, { url: 'https://www.instagram.com/p/DWUR_azCWbN/' })).rejects.toThrow(CommandExecutionError);
    expect(mockHttpDownload).not.toHaveBeenCalled();
  });

  it('downloads media and prints saved directory', async () => {
    mockHttpDownload
      .mockResolvedValueOnce({ success: true, size: 120_000 })
      .mockResolvedValueOnce({ success: true, size: 8_200_000 });

    const page = createPageMock({
      ok: true,
      shortcode: 'DWUR_azCWbN',
      items: [
        { type: 'image', url: 'https://cdn.example.com/photo.webp?foo=1' },
        { type: 'video', url: 'https://cdn.example.com/video.mp4?bar=2' },
      ],
    });

    const result = await cmd.func!(page, {
      url: 'https://www.instagram.com/nasa/p/DWUR_azCWbN/?img_index=1',
      path: './instagram-test',
    });

    expect(result).toBeNull();
    expect((page.goto as any).mock.calls[0]?.[0]).toBe('https://www.instagram.com/p/DWUR_azCWbN/');
    expect(mockHttpDownload).toHaveBeenNthCalledWith(1,
      'https://cdn.example.com/photo.webp?foo=1',
      expect.stringContaining('instagram-test/DWUR_azCWbN/DWUR_azCWbN_01.webp'),
      expect.objectContaining({ timeout: 60000 }),
    );
    expect(mockHttpDownload).toHaveBeenNthCalledWith(2,
      'https://cdn.example.com/video.mp4?bar=2',
      expect.stringContaining('instagram-test/DWUR_azCWbN/DWUR_azCWbN_02.mp4'),
      expect.objectContaining({ timeout: 120000 }),
    );
    expect(logSpy).toHaveBeenCalledWith('📁 saved: instagram-test/DWUR_azCWbN');
  });

  it('uses a cross-platform Downloads default when path is omitted', async () => {
    mockHttpDownload.mockResolvedValueOnce({ success: true, size: 120_000 });

    const page = createPageMock({
      ok: true,
      shortcode: 'DWUR_azCWbN',
      items: [
        { type: 'image', url: 'https://cdn.example.com/photo.webp?foo=1' },
      ],
    });

    await cmd.func!(page, { url: 'https://www.instagram.com/p/DWUR_azCWbN/' });

    expect(mockHttpDownload).toHaveBeenCalledWith(
      'https://cdn.example.com/photo.webp?foo=1',
      expect.stringContaining(`${os.homedir()}/Downloads/Instagram/DWUR_azCWbN/DWUR_azCWbN_01.webp`),
      expect.objectContaining({ timeout: 60000 }),
    );
  });
});
