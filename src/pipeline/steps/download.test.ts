import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IPage } from '../../types.js';

const { mockHttpDownload } = vi.hoisted(() => ({
  mockHttpDownload: vi.fn(),
}));

vi.mock('../../download/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../download/index.js')>('../../download/index.js');
  return {
    ...actual,
    httpDownload: mockHttpDownload,
  };
});

import { stepDownload } from './download.js';

function createMockPage(getCookies: IPage['getCookies']): IPage {
  return {
    goto: vi.fn(),
    evaluate: vi.fn().mockResolvedValue(null),
    getCookies,
    snapshot: vi.fn().mockResolvedValue(''),
    click: vi.fn(),
    typeText: vi.fn(),
    pressKey: vi.fn(),
    scrollTo: vi.fn(),
    getFormState: vi.fn().mockResolvedValue({}),
    wait: vi.fn(),
    tabs: vi.fn().mockResolvedValue([]),
    closeTab: vi.fn(),
    newTab: vi.fn(),
    selectTab: vi.fn(),
    networkRequests: vi.fn().mockResolvedValue([]),
    consoleMessages: vi.fn().mockResolvedValue([]),
    scroll: vi.fn(),
    autoScroll: vi.fn(),
    installInterceptor: vi.fn(),
    getInterceptedRequests: vi.fn().mockResolvedValue([]),
    screenshot: vi.fn().mockResolvedValue(''),
  };
}

describe('stepDownload', () => {
  beforeEach(() => {
    mockHttpDownload.mockReset();
    mockHttpDownload.mockResolvedValue({ success: true, size: 2 });
  });

  it('scopes browser cookies to each direct-download target domain', async () => {
    const page = createMockPage(vi.fn().mockImplementation(async (opts?: { domain?: string }) => {
      const domain = opts?.domain ?? 'unknown';
      return [{ name: 'sid', value: domain, domain }];
    }));

    await stepDownload(
      page,
      {
        url: '${{ item.url }}',
        dir: '/tmp/opencli-download-test',
        filename: '${{ index }}.txt',
        progress: false,
        concurrency: 1,
      },
      [
        { url: 'https://a.example/file-1.txt' },
        { url: 'https://b.example/file-2.txt' },
      ],
      {},
    );

    expect(mockHttpDownload).toHaveBeenNthCalledWith(
      1,
      'https://a.example/file-1.txt',
      '/tmp/opencli-download-test/0.txt',
      expect.objectContaining({ cookies: 'sid=a.example' }),
    );
    expect(mockHttpDownload).toHaveBeenNthCalledWith(
      2,
      'https://b.example/file-2.txt',
      '/tmp/opencli-download-test/1.txt',
      expect.objectContaining({ cookies: 'sid=b.example' }),
    );
  });
});
