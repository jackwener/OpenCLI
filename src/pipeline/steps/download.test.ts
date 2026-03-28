import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IPage } from '../../types.js';

const { mockHttpDownload, mockYtdlpDownload, mockExportCookiesToNetscape } = vi.hoisted(() => ({
  mockHttpDownload: vi.fn(),
  mockYtdlpDownload: vi.fn(),
  mockExportCookiesToNetscape: vi.fn(),
}));

vi.mock('../../download/index.js', async () => {
  const actual = await vi.importActual<typeof import('../../download/index.js')>('../../download/index.js');
  return {
    ...actual,
    httpDownload: mockHttpDownload,
    ytdlpDownload: mockYtdlpDownload,
    exportCookiesToNetscape: mockExportCookiesToNetscape,
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
    waitForCapture: vi.fn().mockResolvedValue(undefined),
  };
}

describe('stepDownload', () => {
  beforeEach(() => {
    mockHttpDownload.mockReset();
    mockHttpDownload.mockResolvedValue({ success: true, size: 2 });
    mockYtdlpDownload.mockReset();
    mockYtdlpDownload.mockResolvedValue({ success: true, size: 2 });
    mockExportCookiesToNetscape.mockReset();
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
        dir: path.join(os.tmpdir(), 'opencli-download-test'),
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
      path.join(os.tmpdir(), 'opencli-download-test', '0.txt'),
      expect.objectContaining({ cookies: 'sid=a.example' }),
    );
    expect(mockHttpDownload).toHaveBeenNthCalledWith(
      2,
      'https://b.example/file-2.txt',
      path.join(os.tmpdir(), 'opencli-download-test', '1.txt'),
      expect.objectContaining({ cookies: 'sid=b.example' }),
    );
  });

  it('builds yt-dlp cookies from all target domains instead of only the first item', async () => {
    const getCookies = vi.fn().mockImplementation(async (opts?: { domain?: string }) => {
      const domain = opts?.domain ?? 'unknown';
      return [{
        name: `sid-${domain}`,
        value: domain,
        domain,
        path: '/',
        secure: false,
        httpOnly: false,
      }];
    });
    const page = createMockPage(getCookies);

    await stepDownload(
      page,
      {
        url: '${{ item.url }}',
        dir: '/tmp/opencli-download-test',
        filename: '${{ index }}.mp4',
        progress: false,
        concurrency: 1,
      },
      [
        { url: 'https://www.youtube.com/watch?v=one' },
        { url: 'https://www.bilibili.com/video/BV1xx411c7mD' },
      ],
      {},
    );

    expect(getCookies).toHaveBeenCalledWith({ domain: 'www.youtube.com' });
    expect(getCookies).toHaveBeenCalledWith({ domain: 'www.bilibili.com' });
    expect(mockExportCookiesToNetscape).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: 'sid-www.youtube.com', domain: 'www.youtube.com' }),
        expect.objectContaining({ name: 'sid-www.bilibili.com', domain: 'www.bilibili.com' }),
      ]),
      expect.any(String),
    );
    expect(mockYtdlpDownload).toHaveBeenCalledTimes(2);
  });
});
