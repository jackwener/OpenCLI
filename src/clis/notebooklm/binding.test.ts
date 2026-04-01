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

  it('does not rebind to another notebook when the real page is already a notebook add-source url', async () => {
    const page = {
      getCurrentUrl: async () => 'https://notebooklm.google.com/',
      evaluate: vi.fn(async () => ({
        url: 'https://notebooklm.google.com/notebook/nb-demo?addSource=true',
        title: 'NotebookLM',
        hostname: 'notebooklm.google.com',
        kind: 'notebook',
        notebookId: 'nb-demo',
        loginRequired: false,
        notebookCount: 1,
        path: '/notebook/nb-demo',
      })),
      goto: vi.fn(async () => undefined),
      wait: vi.fn(async () => undefined),
    };

    await expect(ensureNotebooklmNotebookBinding(page as any)).resolves.toBe(false);
    expect(mockBindCurrentTab).not.toHaveBeenCalled();
    expect(page.goto).toHaveBeenCalledWith('https://notebooklm.google.com/notebook/nb-demo');
  });

  it('canonicalizes the bound notebook page after bind-current lands on add-source', async () => {
    const page = {
      getCurrentUrl: async () => 'https://notebooklm.google.com/',
      evaluate: vi.fn()
        .mockResolvedValueOnce({
          url: 'https://notebooklm.google.com/',
          title: 'NotebookLM',
          hostname: 'notebooklm.google.com',
          kind: 'home',
          notebookId: '',
          loginRequired: false,
          notebookCount: 1,
          path: '/',
        })
        .mockResolvedValueOnce({
          url: 'https://notebooklm.google.com/notebook/nb-live?addSource=true',
          title: 'NotebookLM',
          hostname: 'notebooklm.google.com',
          kind: 'notebook',
          notebookId: 'nb-live',
          loginRequired: false,
          notebookCount: 1,
          path: '/notebook/nb-live',
        }),
      goto: vi.fn(async () => undefined),
      wait: vi.fn(async () => undefined),
    };

    mockBindCurrentTab.mockResolvedValue({});
    await expect(ensureNotebooklmNotebookBinding(page as any)).resolves.toBe(true);
    expect(mockBindCurrentTab).toHaveBeenCalledWith('site:notebooklm', {
      matchDomain: 'notebooklm.google.com',
      matchPathPrefix: '/notebook/',
    });
    expect(page.goto).toHaveBeenCalledWith('https://notebooklm.google.com/notebook/nb-live');
  });
});
