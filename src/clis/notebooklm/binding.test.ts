import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockBindCurrentTab } = vi.hoisted(() => ({
  mockBindCurrentTab: vi.fn(),
}));

vi.mock('../../browser/daemon-client.js', () => ({
  bindCurrentTab: mockBindCurrentTab,
}));

import { ensureNotebooklmNotebookBinding } from './utils.js';

describe('notebooklm automatic binding', () => {
  const originalEndpoint = process.env.OPENCLI_CDP_ENDPOINT;

  beforeEach(() => {
    mockBindCurrentTab.mockReset();
    if (originalEndpoint === undefined) delete process.env.OPENCLI_CDP_ENDPOINT;
    else process.env.OPENCLI_CDP_ENDPOINT = originalEndpoint;
  });

  it('does nothing when the current page is already a notebook page', async () => {
    const page = {
      getCurrentUrl: async () => 'https://notebooklm.google.com/notebook/nb-demo',
    };

    await expect(ensureNotebooklmNotebookBinding(page as any)).resolves.toBe(false);
    expect(mockBindCurrentTab).not.toHaveBeenCalled();
  });

  it('best-effort binds a notebook page through the browser bridge when currently on home', async () => {
    const page = {
      getCurrentUrl: async () => 'https://notebooklm.google.com/',
    };

    mockBindCurrentTab.mockResolvedValue({});
    await expect(ensureNotebooklmNotebookBinding(page as any)).resolves.toBe(true);
    expect(mockBindCurrentTab).toHaveBeenCalledWith('site:notebooklm', {
      matchDomain: 'notebooklm.google.com',
      matchPathPrefix: '/notebook/',
    });
  });

  it('skips daemon binding in direct CDP mode', async () => {
    process.env.OPENCLI_CDP_ENDPOINT = 'ws://127.0.0.1:9222/devtools/page/1';
    const page = {
      getCurrentUrl: async () => 'https://notebooklm.google.com/',
    };

    await expect(ensureNotebooklmNotebookBinding(page as any)).resolves.toBe(false);
    expect(mockBindCurrentTab).not.toHaveBeenCalled();
  });
});
