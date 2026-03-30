import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener<T extends (...args: any[]) => void> = { addListener: (fn: T) => void };

type MockTab = {
  id: number;
  windowId: number;
  url?: string;
  title?: string;
  active?: boolean;
  status?: string;
};

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(_url: string) {}
  send(_data: string): void {}
  close(): void {
    this.onclose?.();
  }
}

function createChromeMock() {
  let nextTabId = 10;
  const tabs: MockTab[] = [
    { id: 1, windowId: 1, url: 'https://automation.example', title: 'automation', active: true, status: 'complete' },
    { id: 2, windowId: 2, url: 'https://user.example', title: 'user', active: true, status: 'complete' },
    { id: 3, windowId: 1, url: 'chrome://extensions', title: 'chrome', active: false, status: 'complete' },
  ];

  const query = vi.fn(async (queryInfo: { windowId?: number; active?: boolean } = {}) => {
    return tabs.filter((tab) => {
      if (queryInfo.windowId !== undefined && tab.windowId !== queryInfo.windowId) return false;
      if (queryInfo.active !== undefined && !!tab.active !== queryInfo.active) return false;
      return true;
    });
  });
  const create = vi.fn(async ({ windowId, url, active }: { windowId?: number; url?: string; active?: boolean }) => {
    const tab: MockTab = {
      id: nextTabId++,
      windowId: windowId ?? 999,
      url,
      title: url ?? 'blank',
      active: !!active,
      status: 'complete',
    };
    tabs.push(tab);
    return tab;
  });
  const update = vi.fn(async (tabId: number, updates: { active?: boolean; url?: string }) => {
    const tab = tabs.find((entry) => entry.id === tabId);
    if (!tab) throw new Error(`Unknown tab ${tabId}`);
    if (updates.active !== undefined) tab.active = updates.active;
    if (updates.url !== undefined) tab.url = updates.url;
    return tab;
  });

  const chrome = {
    tabs: {
      query,
      create,
      update,
      remove: vi.fn(async (_tabId: number) => {}),
      get: vi.fn(async (tabId: number) => {
        const tab = tabs.find((entry) => entry.id === tabId);
        if (!tab) throw new Error(`Unknown tab ${tabId}`);
        return tab;
      }),
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() } as Listener<(id: number, info: chrome.tabs.TabChangeInfo) => void>,
    },
    windows: {
      get: vi.fn(async (windowId: number) => ({ id: windowId })),
      create: vi.fn(async ({ url, focused, width, height, type }: any) => ({ id: 1, url, focused, width, height, type })),
      remove: vi.fn(async (_windowId: number) => {}),
      onRemoved: { addListener: vi.fn() } as Listener<(windowId: number) => void>,
    },
    alarms: {
      create: vi.fn(),
      onAlarm: { addListener: vi.fn() } as Listener<(alarm: { name: string }) => void>,
    },
    runtime: {
      onInstalled: { addListener: vi.fn() } as Listener<() => void>,
      onStartup: { addListener: vi.fn() } as Listener<() => void>,
      onMessage: { addListener: vi.fn() } as Listener<(msg: unknown, sender: unknown, sendResponse: (value: unknown) => void) => void>,
      getManifest: vi.fn(() => ({ version: 'test-version' })),
    },
    cookies: {
      getAll: vi.fn(async () => []),
    },
  };

  return { chrome, tabs, query, create, update };
}

describe('background tab isolation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('lists only automation-window web tabs', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId('site:twitter', 1);

    const result = await mod.__test__.handleTabs({ id: '1', action: 'tabs', op: 'list', workspace: 'site:twitter' }, 'site:twitter');

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([
      {
        index: 0,
        tabId: 1,
        url: 'https://automation.example',
        title: 'automation',
        active: true,
      },
    ]);
  });

  it('creates new tabs inside the automation window', async () => {
    const { chrome, create } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId('site:twitter', 1);

    const result = await mod.__test__.handleTabs({ id: '2', action: 'tabs', op: 'new', url: 'https://new.example', workspace: 'site:twitter' }, 'site:twitter');

    expect(result.ok).toBe(true);
    expect(create).toHaveBeenCalledWith({ windowId: 1, url: 'https://new.example', active: true });
  });

  it('treats normalized same-url navigate as already complete', async () => {
    const { chrome, tabs, update } = createChromeMock();
    tabs[0].url = 'https://www.bilibili.com/';
    tabs[0].title = 'bilibili';
    tabs[0].status = 'complete';
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId('site:bilibili', 1);

    const result = await mod.__test__.handleNavigate(
      { id: 'same-url', action: 'navigate', url: 'https://www.bilibili.com', workspace: 'site:bilibili' },
      'site:bilibili',
    );

    expect(result).toEqual({
      id: 'same-url',
      ok: true,
      data: {
        title: 'bilibili',
        url: 'https://www.bilibili.com/',
        tabId: 1,
        timedOut: false,
      },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('keeps hash routes distinct when comparing target URLs', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');

    expect(mod.__test__.isTargetUrl('https://example.com/', 'https://example.com')).toBe(true);
    expect(mod.__test__.isTargetUrl('https://example.com/#feed', 'https://example.com/#settings')).toBe(false);
    expect(mod.__test__.isTargetUrl('https://example.com/app/', 'https://example.com/app')).toBe(false);
  });

  it('reports sessions per workspace', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId('site:twitter', 1);
    mod.__test__.setAutomationWindowId('site:zhihu', 2);

    const result = await mod.__test__.handleSessions({ id: '3', action: 'sessions' });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ workspace: 'site:twitter', windowId: 1 }),
      expect.objectContaining({ workspace: 'site:zhihu', windowId: 2 }),
    ]));
  });

  it('rebinds site:notebooklm to the active notebook tab instead of a home tab', async () => {
    const { chrome, tabs } = createChromeMock();
    tabs[0].url = 'https://notebooklm.google.com/';
    tabs[0].title = 'NotebookLM Home';
    tabs[1].url = 'https://notebooklm.google.com/notebook/nb-live';
    tabs[1].title = 'Live Notebook';
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId('site:notebooklm', 1);

    const tabId = await mod.__test__.resolveTabId(undefined, 'site:notebooklm');

    expect(tabId).toBe(2);
    expect(mod.__test__.getSession('site:notebooklm')).toEqual(expect.objectContaining({
      windowId: 2,
      preferredTabId: 2,
      owned: false,
    }));
  });

  it('prefers a notebook tab over an active home tab for site:notebooklm', async () => {
    const { chrome, tabs } = createChromeMock();
    tabs[0].url = 'https://notebooklm.google.com/';
    tabs[0].title = 'NotebookLM Home';
    tabs[0].active = true;
    tabs[1].url = 'https://notebooklm.google.com/notebook/nb-passive';
    tabs[1].title = 'Notebook';
    tabs[1].active = false;
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId('site:notebooklm', 1);

    const tabId = await mod.__test__.resolveTabId(undefined, 'site:notebooklm');

    expect(tabId).toBe(2);
    expect(mod.__test__.getSession('site:notebooklm')).toEqual(expect.objectContaining({
      windowId: 2,
      preferredTabId: 2,
      owned: false,
    }));
  });

  it('detaches an adopted workspace session on idle instead of closing the user window', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);
    vi.useFakeTimers();

    const mod = await import('./background');
    mod.__test__.setSession('site:notebooklm', {
      windowId: 2,
      preferredTabId: 2,
      owned: false,
    });

    mod.__test__.resetWindowIdleTimer('site:notebooklm');
    await vi.advanceTimersByTimeAsync(30001);

    expect(chrome.windows.remove).not.toHaveBeenCalled();
    expect(mod.__test__.getSession('site:notebooklm')).toBeNull();
  });

  it('binds the active NotebookLM tab into the workspace explicitly', async () => {
    const { chrome, tabs } = createChromeMock();
    tabs[1].url = 'https://notebooklm.google.com/notebook/nb-active';
    tabs[1].title = 'Bound Notebook';
    tabs[1].active = true;
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    const result = await mod.__test__.handleBindCurrent(
      {
        id: 'bind-current',
        action: 'bind-current',
        workspace: 'site:notebooklm',
        matchDomain: 'notebooklm.google.com',
        matchPathPrefix: '/notebook/',
      },
      'site:notebooklm',
    );

    expect(result).toEqual({
      id: 'bind-current',
      ok: true,
      data: expect.objectContaining({
        tabId: 2,
        windowId: 2,
        url: 'https://notebooklm.google.com/notebook/nb-active',
        title: 'Bound Notebook',
        workspace: 'site:notebooklm',
      }),
    });
    expect(mod.__test__.getSession('site:notebooklm')).toEqual(expect.objectContaining({
      windowId: 2,
      preferredTabId: 2,
      owned: false,
    }));
  });

  it('bind-current falls back to another matching notebook tab in the current window', async () => {
    const { chrome, tabs } = createChromeMock();
    tabs[0].windowId = 2;
    tabs[0].url = 'https://notebooklm.google.com/';
    tabs[0].title = 'NotebookLM Home';
    tabs[0].active = true;
    tabs[1].url = 'https://notebooklm.google.com/notebook/nb-passive';
    tabs[1].title = 'Passive Notebook';
    tabs[1].active = false;
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    const result = await mod.__test__.handleBindCurrent(
      {
        id: 'bind-fallback',
        action: 'bind-current',
        workspace: 'site:notebooklm',
        matchDomain: 'notebooklm.google.com',
        matchPathPrefix: '/notebook/',
      },
      'site:notebooklm',
    );

    expect(result).toEqual({
      id: 'bind-fallback',
      ok: true,
      data: expect.objectContaining({
        tabId: 2,
        windowId: 2,
        url: 'https://notebooklm.google.com/notebook/nb-passive',
        title: 'Passive Notebook',
      }),
    });
  });

  it('bind-current falls back to a matching notebook tab in another window of the same profile', async () => {
    const { chrome, tabs } = createChromeMock();
    tabs[0].windowId = 3;
    tabs[0].url = 'https://notebooklm.google.com/';
    tabs[0].title = 'NotebookLM Home';
    tabs[0].active = true;
    tabs[1].windowId = 2;
    tabs[1].url = 'https://notebooklm.google.com/notebook/nb-other-window';
    tabs[1].title = 'Notebook In Other Window';
    tabs[1].active = false;
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    const result = await mod.__test__.handleBindCurrent(
      {
        id: 'bind-cross-window',
        action: 'bind-current',
        workspace: 'site:notebooklm',
        matchDomain: 'notebooklm.google.com',
        matchPathPrefix: '/notebook/',
      },
      'site:notebooklm',
    );

    expect(result).toEqual({
      id: 'bind-cross-window',
      ok: true,
      data: expect.objectContaining({
        tabId: 2,
        windowId: 2,
        url: 'https://notebooklm.google.com/notebook/nb-other-window',
        title: 'Notebook In Other Window',
      }),
    });
  });

  it('rejects bind-current when the active tab is not NotebookLM', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    const result = await mod.__test__.handleBindCurrent(
      {
        id: 'bind-miss',
        action: 'bind-current',
        workspace: 'site:notebooklm',
        matchDomain: 'notebooklm.google.com',
        matchPathPrefix: '/notebook/',
      },
      'site:notebooklm',
    );

    expect(result).toEqual({
      id: 'bind-miss',
      ok: false,
      error: 'No visible tab matching notebooklm.google.com /notebook/',
    });
  });
});
