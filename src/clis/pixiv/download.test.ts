import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '../../registry.js';
import { createPageMock } from './test-utils.js';

// Mock download dependencies before importing the adapter
const { mockHttpDownload, mockMkdirSync } = vi.hoisted(() => ({
  mockHttpDownload: vi.fn(),
  mockMkdirSync: vi.fn(),
}));

vi.mock('../../download/index.js', () => ({
  formatCookieHeader: vi.fn().mockReturnValue('cookie=value'),
  httpDownload: mockHttpDownload,
}));

vi.mock('node:fs', () => ({
  mkdirSync: mockMkdirSync,
}));

// Now import the adapter (after mocks are set up)
await import('./download.js');

describe('pixiv download', () => {
  it('throws AuthRequiredError on HTTP error', async () => {
    const cmd = getRegistry().get('pixiv/download');
    expect(cmd?.func).toBeTypeOf('function');

    const page = createPageMock([{ error: 403 }]);

    await expect(cmd!.func!(page, { 'illust-id': '12345', output: '/tmp/test' })).rejects.toThrow(
      'HTTP 403'
    );
  });

  it('returns failure when no images found', async () => {
    const cmd = getRegistry().get('pixiv/download');

    const page = createPageMock([{ body: [] }]);

    const result = (await cmd!.func!(page, { 'illust-id': '12345', output: '/tmp/test' })) as any[];
    expect(result).toEqual([{ index: 0, type: '-', status: 'failed', size: 'No images found' }]);
  });

  it('downloads images with Referer header', async () => {
    const cmd = getRegistry().get('pixiv/download');

    mockHttpDownload.mockResolvedValue({ success: true, size: 1024000 });

    const page = createPageMock([
      {
        body: [
          { urls: { original: 'https://i.pximg.net/img-original/img/2025/01/01/00/00/00/12345_p0.png' } },
          { urls: { original: 'https://i.pximg.net/img-original/img/2025/01/01/00/00/00/12345_p1.jpg' } },
        ],
      },
    ]);

    const result = (await cmd!.func!(page, { 'illust-id': '12345', output: '/tmp/test' })) as any[];

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ index: 1, type: 'image', status: 'success' });
    expect(result[1]).toMatchObject({ index: 2, type: 'image', status: 'success' });

    // Verify Referer header was passed
    expect(mockHttpDownload).toHaveBeenCalledTimes(2);
    const firstCallOpts = mockHttpDownload.mock.calls[0][2];
    expect(firstCallOpts.headers).toEqual({ Referer: 'https://www.pixiv.net/' });
  });

  it('handles individual download failures gracefully', async () => {
    const cmd = getRegistry().get('pixiv/download');

    mockHttpDownload
      .mockResolvedValueOnce({ success: true, size: 512000 })
      .mockRejectedValueOnce(new Error('Connection timeout'));

    const page = createPageMock([
      {
        body: [
          { urls: { original: 'https://i.pximg.net/img/12345_p0.png' } },
          { urls: { original: 'https://i.pximg.net/img/12345_p1.png' } },
        ],
      },
    ]);

    const result = (await cmd!.func!(page, { 'illust-id': '12345', output: '/tmp/test' })) as any[];

    expect(result).toHaveLength(2);
    expect(result[0].status).toBe('success');
    expect(result[1].status).toBe('failed');
    expect(result[1].size).toBe('Connection timeout');
  });
});
