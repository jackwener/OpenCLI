import { describe, expect, it, vi } from 'vitest';
import type { IPage } from '../../src/types.js';
import { __test__, loadSubstackArchive, loadSubstackFeed } from './utils.js';

function createPageMock(evaluateResult: unknown): IPage {
  return {
    goto: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue(evaluateResult),
    snapshot: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    typeText: vi.fn().mockResolvedValue(undefined),
    pressKey: vi.fn().mockResolvedValue(undefined),
    scrollTo: vi.fn().mockResolvedValue(undefined),
    getFormState: vi.fn().mockResolvedValue({}),
    wait: vi.fn().mockResolvedValue(undefined),
    tabs: vi.fn().mockResolvedValue([]),
    selectTab: vi.fn().mockResolvedValue(undefined),
    networkRequests: vi.fn().mockResolvedValue([]),
    consoleMessages: vi.fn().mockResolvedValue([]),
    scroll: vi.fn().mockResolvedValue(undefined),
    autoScroll: vi.fn().mockResolvedValue(undefined),
    installInterceptor: vi.fn().mockResolvedValue(undefined),
    getInterceptedRequests: vi.fn().mockResolvedValue([]),
    getCookies: vi.fn().mockResolvedValue([]),
    screenshot: vi.fn().mockResolvedValue(''),
    waitForCapture: vi.fn().mockResolvedValue(undefined),
  };
}

describe('substack utils wait selectors', () => {
  it('waits for both feed link shapes before scraping the feed', async () => {
    const page = createPageMock([]);

    await loadSubstackFeed(page, 'https://substack.com/', 5);

    expect(page.wait).toHaveBeenCalledWith({
      selector: __test__.FEED_POST_LINK_SELECTOR,
      timeout: 5,
    });
  });

  it('waits for archive post links before scraping archive pages', async () => {
    const page = createPageMock([]);

    await loadSubstackArchive(page, 'https://example.substack.com', 5);

    expect(page.wait).toHaveBeenCalledWith({
      selector: __test__.ARCHIVE_POST_LINK_SELECTOR,
      timeout: 5,
    });
  });
});
