import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { createPageMock } from '../test-utils.js';

// Mock the shared download helper before importing the adapter.
const { mockDownloadMedia, mockCheckYtdlp } = vi.hoisted(() => ({
  mockDownloadMedia: vi.fn(),
  mockCheckYtdlp: vi.fn(),
}));
vi.mock('@jackwener/opencli/download', () => ({ checkYtdlp: mockCheckYtdlp }));
vi.mock('@jackwener/opencli/download/media-download', () => ({ downloadMedia: mockDownloadMedia }));

/** downloadMedia result where every file succeeds. */
const allOk = (items) => items.map((item, i) => ({ index: i + 1, type: item.type, status: 'success', size: '10B' }));

await import('./download.js');

let cmd;

function pinDetail(overrides = {}) {
  return {
    resource_response: {
      data: { id: '1234567890123456', images: { orig: { url: 'https://i.pinimg.com/originals/a/b/c.png' } }, ...overrides },
    },
  };
}

beforeAll(() => {
  cmd = getRegistry().get('pinterest/download');
  expect(cmd?.func).toBeTypeOf('function');
});

describe('pinterest download', () => {
  beforeEach(() => {
    mockDownloadMedia.mockReset();
    mockDownloadMedia.mockImplementation(async (items) => allOk(items));
    mockCheckYtdlp.mockReset();
    mockCheckYtdlp.mockReturnValue(true);
  });

  it('requires exactly one of a pin or --board', async () => {
    await expect(cmd.func(createPageMock([]), { output: '/tmp/x' })).rejects.toThrow(/either a pin or --board/);
    await expect(cmd.func(createPageMock([]), { pin: '123', board: 'me/home', output: '/tmp/x' })).rejects.toThrow(/either a pin or --board/);
    await expect(cmd.func(createPageMock([]), { pin: '123', section: 'cats', output: '/tmp/x' })).rejects.toThrow(/--section requires --board/);
  });

  it('throws ArgumentError on a non-pin reference', async () => {
    await expect(cmd.func(createPageMock([]), { pin: 'nope', output: '/tmp/x' })).rejects.toThrow(ArgumentError);
  });

  it('throws EmptyResultError when the pin is missing', async () => {
    const page = createPageMock([{ resource_response: { data: {} } }]);
    await expect(cmd.func(page, { pin: '123', output: '/tmp/x' })).rejects.toThrow(EmptyResultError);
  });

  it('throws CommandExecutionError when the pin has no media', async () => {
    const page = createPageMock([pinDetail({ images: {} })]);
    await expect(cmd.func(page, { pin: '123', output: '/tmp/x' })).rejects.toThrow(CommandExecutionError);
    expect(mockDownloadMedia).not.toHaveBeenCalled();
  });

  it('downloads the original image and returns a success row', async () => {
    const page = createPageMock([pinDetail()]);
    const result = await cmd.func(page, { pin: 'https://www.pinterest.com/pin/1234567890123456/', output: '/tmp/x' });
    expect(result).toEqual([{
      pinId: '1234567890123456',
      index: 1,
      type: 'image',
      status: 'success',
      size: '10B',
      path: '/tmp/x/1234567890123456.png',
      nextBookmark: '',
    }]);
    expect(mockDownloadMedia.mock.calls[0][0]).toEqual([expect.objectContaining({
      type: 'image',
      url: 'https://i.pinimg.com/originals/a/b/c.png',
      filename: '1234567890123456.png',
    })]);
    expect(mockDownloadMedia.mock.calls[0][1]).toMatchObject({ output: '/tmp/x' });
  });

  it('throws CommandExecutionError when the download fails', async () => {
    mockDownloadMedia.mockResolvedValue([{ index: 1, type: 'image', status: 'failed', size: 'network' }]);
    const page = createPageMock([pinDetail()]);
    await expect(cmd.func(page, { pin: '1234567890123456', output: '/tmp/x' })).rejects.toThrow(/network/);
  });

  it('downloads the best mp4 rendition of a video pin', async () => {
    const page = createPageMock([pinDetail({ videos: { video_list: {
      V_HLSV4: { url: 'https://v1.pinimg.com/videos/a.m3u8', height: 1080 },
      V_480P: { url: 'https://v1.pinimg.com/videos/480p/a.mp4', height: 480 },
      V_720P: { url: 'https://v1.pinimg.com/videos/720p/a.mp4', height: 720 },
    } } })]);
    const result = await cmd.func(page, { pin: '1234567890123456', output: '/tmp/x' });
    expect(result[0]).toMatchObject({ type: 'video', status: 'success' });
    expect(mockDownloadMedia.mock.calls[0][0][0]).toMatchObject({
      type: 'video',
      url: 'https://v1.pinimg.com/videos/720p/a.mp4',
      filename: '1234567890123456.mp4',
    });
  });

  it('routes an HLS-only video to yt-dlp, and fails with a hint when yt-dlp is missing', async () => {
    const hls = () => pinDetail({ videos: { video_list: { V_HLSV4: { url: 'https://v1.pinimg.com/videos/a.m3u8' } } } });
    await cmd.func(createPageMock([hls()]), { pin: '1234567890123456', output: '/tmp/x' });
    expect(mockDownloadMedia.mock.calls[0][0][0]).toMatchObject({ type: 'video-ytdlp', filename: '1234567890123456.mp4' });

    mockDownloadMedia.mockClear();
    mockCheckYtdlp.mockReturnValue(false);
    await expect(cmd.func(createPageMock([hls()]), { pin: '1234567890123456', output: '/tmp/x' })).rejects.toThrow(/without yt-dlp/);
    expect(mockDownloadMedia).not.toHaveBeenCalled();
  });

  it('downloads every slide of a carousel pin with numbered file names', async () => {
    const slot = (name) => ({ images: { '236x': { url: `https://i.pinimg.com/236x/${name}.jpg` }, '736x': { url: `https://i.pinimg.com/736x/${name}.jpg` } } });
    const page = createPageMock([pinDetail({ carousel_data: { carousel_slots: [slot('a'), slot('b')] } })]);
    const result = await cmd.func(page, { pin: '1234567890123456', output: '/tmp/x' });
    expect(result.map((r) => r.index)).toEqual([1, 2]);
    expect(mockDownloadMedia.mock.calls[0][0].map((item) => [item.url, item.filename])).toEqual([
      ['https://i.pinimg.com/736x/a.jpg', '1234567890123456_1.jpg'],
      ['https://i.pinimg.com/736x/b.jpg', '1234567890123456_2.jpg'],
    ]);
  });

  it('downloads a board in one pass and reports a failed file as a row instead of aborting', async () => {
    mockDownloadMedia.mockResolvedValue([
      { index: 1, type: 'image', status: 'success', size: '10B' },
      { index: 2, type: 'image', status: 'failed', size: 'network' },
    ]);
    const gridPin = (id) => ({ type: 'pin', id, images: { orig: { url: `https://i.pinimg.com/originals/${id}.jpg` } } });
    const page = createPageMock([
      { resource_response: { data: { id: '999', name: 'Home' } } },
      { resource_response: { data: [gridPin('1'), gridPin('2')], bookmark: 'bm1' } },
    ]);
    const result = await cmd.func(page, { board: 'me/home', limit: 2, output: '/tmp/x' });
    expect(result.map((r) => [r.pinId, r.status, r.size, r.nextBookmark])).toEqual([
      ['1', 'success', '10B', 'bm1'],
      ['2', 'failed', 'network', 'bm1'],
    ]);
    expect(mockDownloadMedia).toHaveBeenCalledTimes(1);
  });
});
