import { describe, expect, it, vi } from 'vitest';
import type { IPage } from '../../types.js';
import { getRegistry } from '../../registry.js';

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

function createPageMock(evaluateResults: any[]): IPage {
  const evaluate = vi.fn();
  for (const result of evaluateResults) {
    evaluate.mockResolvedValueOnce(result);
  }

  return {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate,
    snapshot: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    typeText: vi.fn().mockResolvedValue(undefined),
    pressKey: vi.fn().mockResolvedValue(undefined),
    scrollTo: vi.fn().mockResolvedValue(undefined),
    getFormState: vi.fn().mockResolvedValue({ forms: [], orphanFields: [] }),
    wait: vi.fn().mockResolvedValue(undefined),
    tabs: vi.fn().mockResolvedValue([]),
    closeTab: vi.fn().mockResolvedValue(undefined),
    newTab: vi.fn().mockResolvedValue(undefined),
    selectTab: vi.fn().mockResolvedValue(undefined),
    networkRequests: vi.fn().mockResolvedValue([]),
    consoleMessages: vi.fn().mockResolvedValue([]),
    scroll: vi.fn().mockResolvedValue(undefined),
    autoScroll: vi.fn().mockResolvedValue(undefined),
    installInterceptor: vi.fn().mockResolvedValue(undefined),
    getInterceptedRequests: vi.fn().mockResolvedValue([]),
    getCookies: vi.fn().mockResolvedValue([]),
    screenshot: vi.fn().mockResolvedValue(''),
  };
}

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
