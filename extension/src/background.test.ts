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
      move: vi.fn(async (tabId: number, moveProps: { windowId: number; index: number }) => {
        const tab = tabs.find((entry) => entry.id === tabId);
        if (!tab) throw new Error(`Unknown tab ${tabId}`);
        tab.windowId = moveProps.windowId;
        return tab;
      }),
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() } as Listener<(id: number, info: chrome.tabs.TabChangeInfo) => void>,
      onRemoved: { addListener: vi.fn() } as Listener<(tabId: number) => void>,
    },
    debugger: {
      getTargets: vi.fn(async () => tabs.map(t => ({
        type: 'page',
        id: `target-${t.id}`,
        tabId: t.id,
        url: t.url ?? '',
        title: t.title ?? '',
        attached: false,
      }))),
      attach: vi.fn(),
      detach: vi.fn(),
      sendCommand: vi.fn(),
      onDetach: { addListener: vi.fn() } as Listener<(source: { tabId?: number }) => void>,
      onEvent: { addListener: vi.fn() } as Listener<(source: any, method: string, params: any) => void>,
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
        page: 'target-1',
        url: 'https://automation.example',
        title: 'automation',
        active: true,
      },
    ]);
  });

  it('lists cross-origin frames in the same order exposed by snapshot [F#] markers', async () => {
    const { chrome } = createChromeMock();
    chrome.debugger.sendCommand = vi.fn(async (_target: unknown, method: string) => {
      if (method === 'Runtime.enable') return {};
      if (method === 'Runtime.evaluate') return { result: { value: 1 } };
      if (method === 'Page.getFrameTree') {
        return {
          frameTree: {
            frame: { id: 'root', url: 'https://main.example/' },
            childFrames: [
              {
                frame: { id: 'same-origin-parent', url: 'https://main.example/embed' },
                childFrames: [
                  {
                    frame: { id: 'cross-origin-nested', url: 'https://x.example/widget', name: 'nested-x' },
                    childFrames: [
                      {
                        frame: { id: 'hidden-descendant', url: 'https://x.example/inner' },
                      },
                    ],
                  },
                ],
              },
              {
                frame: { id: 'cross-origin-sibling', url: 'https://y.example/iframe', name: 'sibling-y' },
              },
            ],
          },
        };
      }
      return {};
    });
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId('site:twitter', 1);

    const result = await mod.__test__.handleCommand({ id: 'frames', action: 'frames', workspace: 'site:twitter' });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([
      { index: 0, frameId: 'cross-origin-nested', url: 'https://x.example/widget', name: 'nested-x' },
      { index: 1, frameId: 'cross-origin-sibling', url: 'https://y.example/iframe', name: 'sibling-y' },
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

  it('closes a tab by page identity', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId('site:twitter', 1);

    const result = await mod.__test__.handleTabs(
      { id: 'close-by-page', action: 'tabs', op: 'close', workspace: 'site:twitter', page: 'target-1' },
      'site:twitter',
    );

    expect(result).toEqual({
      id: 'close-by-page',
      ok: true,
      data: { closed: 'target-1' },
    });
    expect(chrome.tabs.remove).toHaveBeenCalledWith(1);
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
      page: 'target-1',
      data: {
        title: 'bilibili',
        url: 'https://www.bilibili.com/',
        timedOut: false,
      },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('keeps the debugger attached during navigation when network capture is active', async () => {
    const { chrome, tabs } = createChromeMock();
    const onUpdatedListeners: Array<(id: number, info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void> = [];
    chrome.tabs.onUpdated.addListener = vi.fn((fn) => { onUpdatedListeners.push(fn); });
    chrome.tabs.onUpdated.removeListener = vi.fn((fn) => {
      const idx = onUpdatedListeners.indexOf(fn);
      if (idx >= 0) onUpdatedListeners.splice(idx, 1);
    });
    chrome.tabs.update = vi.fn(async (tabId: number, updates: { active?: boolean; url?: string }) => {
      const tab = tabs.find((entry) => entry.id === tabId);
      if (!tab) throw new Error(`Unknown tab ${tabId}`);
      if (updates.active !== undefined) tab.active = updates.active;
      if (updates.url !== undefined) tab.url = updates.url;
      tab.status = 'complete';
      for (const listener of [...onUpdatedListeners]) {
        listener(tabId, { status: 'complete', url: tab.url }, tab as chrome.tabs.Tab);
      }
      return tab;
    });
    vi.stubGlobal('chrome', chrome);

    const detachMock = vi.fn(async () => {});
    vi.doMock('./cdp', () => ({
      registerListeners: vi.fn(),
      hasActiveNetworkCapture: vi.fn(() => true),
      detach: detachMock,
    }));

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId('site:eos', 1);

    const result = await mod.__test__.handleNavigate(
      { id: 'capture-nav', action: 'navigate', url: 'https://eos.douyin.com/livesite/live/current', workspace: 'site:eos' },
      'site:eos',
    );

    expect(result.ok).toBe(true);
    expect(detachMock).not.toHaveBeenCalled();
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

  it('can execute concurrently on two pages in the same workspace', async () => {
    const { chrome, tabs } = createChromeMock();
    tabs.push({
      id: 4,
      windowId: 1,
      url: 'https://automation-2.example',
      title: 'automation-2',
      active: false,
      status: 'complete',
    });
    vi.stubGlobal('chrome', chrome);

    let inFlight = 0;
    let maxInFlight = 0;
    vi.doMock('./cdp', () => ({
      registerListeners: vi.fn(),
      evaluateAsync: vi.fn(async (tabId: number, code: string) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise(resolve => setTimeout(resolve, 30));
        inFlight--;
        return { tabId, code };
      }),
    }));

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId('site:parallel', 1);

    const [first, second] = await Promise.all([
      mod.__test__.handleExec({ id: 'p1', action: 'exec', workspace: 'site:parallel', page: 'target-1', code: 'window.__task = 1' }, 'site:parallel'),
      mod.__test__.handleExec({ id: 'p2', action: 'exec', workspace: 'site:parallel', page: 'target-4', code: 'window.__task = 2' }, 'site:parallel'),
    ]);

    expect(first).toEqual(expect.objectContaining({
      ok: true,
      page: 'target-1',
      data: { tabId: 1, code: 'window.__task = 1' },
    }));
    expect(second).toEqual(expect.objectContaining({
      ok: true,
      page: 'target-4',
      data: { tabId: 4, code: 'window.__task = 2' },
    }));
    expect(maxInFlight).toBe(2);
  });

  it('can execute concurrently across two workspaces/windows', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    let inFlight = 0;
    let maxInFlight = 0;
    vi.doMock('./cdp', () => ({
      registerListeners: vi.fn(),
      evaluateAsync: vi.fn(async (tabId: number, code: string) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise(resolve => setTimeout(resolve, 30));
        inFlight--;
        return { tabId, code };
      }),
    }));

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId('site:twitter', 1);
    mod.__test__.setAutomationWindowId('site:zhihu', 2);

    const [first, second] = await Promise.all([
      mod.__test__.handleExec({ id: 'w1', action: 'exec', workspace: 'site:twitter', code: 'window.__window = 1' }, 'site:twitter'),
      mod.__test__.handleExec({ id: 'w2', action: 'exec', workspace: 'site:zhihu', code: 'window.__window = 2' }, 'site:zhihu'),
    ]);

    expect(first).toEqual(expect.objectContaining({
      ok: true,
      page: 'target-1',
      data: { tabId: 1, code: 'window.__window = 1' },
    }));
    expect(second).toEqual(expect.objectContaining({
      ok: true,
      page: 'target-2',
      data: { tabId: 2, code: 'window.__window = 2' },
    }));
    expect(maxInFlight).toBe(2);
  });

  it('keeps site:notebooklm inside its owned automation window instead of rebinding to a user tab', async () => {
    const { chrome, tabs } = createChromeMock();
    tabs[0].url = 'https://notebooklm.google.com/';
    tabs[0].title = 'NotebookLM Home';
    tabs[1].url = 'https://notebooklm.google.com/notebook/nb-live';
    tabs[1].title = 'Live Notebook';
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId('site:notebooklm', 1);

    const tabId = await mod.__test__.resolveTabId(undefined, 'site:notebooklm');

    expect(tabId).toBe(1);
    expect(mod.__test__.getSession('site:notebooklm')).toEqual(expect.objectContaining({
      windowId: 1,
    }));
  });

  it('moves drifted tab back to automation window instead of creating a new one', async () => {
    const { chrome, tabs } = createChromeMock();
    // Tab 1 belongs to automation window 1 but drifted to window 2
    tabs[0].windowId = 2;
    tabs[0].url = 'https://twitter.com/home';
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId('site:twitter', 1);

    const tabId = await mod.__test__.resolveTabId(1, 'site:twitter');

    // Should have moved tab 1 back to window 1 and reused it
    expect(chrome.tabs.move).toHaveBeenCalledWith(1, { windowId: 1, index: -1 });
    expect(tabId).toBe(1);
  });

  it('falls through to re-resolve when drifted tab move fails', async () => {
    const { chrome, tabs } = createChromeMock();
    tabs[0].windowId = 2;
    tabs[0].url = 'https://twitter.com/home';
    // Make move fail
    chrome.tabs.move = vi.fn(async () => { throw new Error('Cannot move tab'); });
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId('site:twitter', 1);

    // Should still resolve (by finding/creating a tab in the correct window)
    const tabId = await mod.__test__.resolveTabId(1, 'site:twitter');
    expect(typeof tabId).toBe('number');
  });

  it('idle timeout closes the automation window for site:notebooklm', async () => {
    const { chrome, tabs } = createChromeMock();
    tabs[0].url = 'https://notebooklm.google.com/';
    tabs[0].title = 'NotebookLM Home';
    tabs[0].active = true;

    vi.useFakeTimers();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId('site:notebooklm', 1);

    mod.__test__.resetWindowIdleTimer('site:notebooklm');
    await vi.advanceTimersByTimeAsync(30001);

    expect(chrome.windows.remove).toHaveBeenCalledWith(1);
    expect(mod.__test__.getSession('site:notebooklm')).toBeNull();
  });

  it('uses 10-minute timeout for browser:* workspaces', async () => {
    const { chrome } = createChromeMock();
    vi.useFakeTimers();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId('browser:default', 1);

    mod.__test__.resetWindowIdleTimer('browser:default');
    // After 30s (adapter timeout), session should still be alive
    await vi.advanceTimersByTimeAsync(30001);
    expect(mod.__test__.getSession('browser:default')).not.toBeNull();

    // After 10 min total, session should be cleaned up
    await vi.advanceTimersByTimeAsync(600000 - 30001);
    expect(chrome.windows.remove).toHaveBeenCalledWith(1);
    expect(mod.__test__.getSession('browser:default')).toBeNull();
  });

  it('clears workspaceTimeoutOverrides on idle expiry', async () => {
    const { chrome } = createChromeMock();
    vi.useFakeTimers();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId('browser:test', 1);

    // Set a custom timeout override
    mod.__test__.workspaceTimeoutOverrides.set('browser:test', 120_000);
    expect(mod.__test__.getIdleTimeout('browser:test')).toBe(120_000);

    // Trigger idle timer with the custom timeout
    mod.__test__.resetWindowIdleTimer('browser:test');
    await vi.advanceTimersByTimeAsync(120001);

    // Override should be cleaned up
    expect(mod.__test__.workspaceTimeoutOverrides.has('browser:test')).toBe(false);
    expect(mod.__test__.getSession('browser:test')).toBeNull();
    // Should fall back to default interactive timeout
    expect(mod.__test__.getIdleTimeout('browser:test')).toBe(600_000);
  });

  it('clears workspaceTimeoutOverrides on explicit close', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId('browser:close-test', 1);
    mod.__test__.workspaceTimeoutOverrides.set('browser:close-test', 300_000);

    const result = await mod.__test__.handleCommand({
      id: 'close-1',
      action: 'close-window',
      workspace: 'browser:close-test',
    });

    expect(result.ok).toBe(true);
    expect(mod.__test__.workspaceTimeoutOverrides.has('browser:close-test')).toBe(false);
  });

  it('applies idleTimeout from command to workspace override', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId('browser:custom', 1);

    // Default for browser:* is 10 min
    expect(mod.__test__.getIdleTimeout('browser:custom')).toBe(600_000);

    // Send a command with custom idleTimeout (in seconds)
    await mod.__test__.handleCommand({
      id: 'custom-1',
      action: 'sessions',
      workspace: 'browser:custom',
      idleTimeout: 120,
    });

    // Override should now be 120s = 120000ms
    expect(mod.__test__.getIdleTimeout('browser:custom')).toBe(120_000);
  });

  it('clears workspaceTimeoutOverrides when user manually closes automation window', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');

    // Set up a session with window ID 42 and a custom timeout override
    mod.__test__.setAutomationWindowId('browser:manual', 42);
    mod.__test__.workspaceTimeoutOverrides.set('browser:manual', 180_000);
    expect(mod.__test__.getIdleTimeout('browser:manual')).toBe(180_000);

    // Simulate user closing the window — invoke the onRemoved listener
    const onRemovedListener = chrome.windows.onRemoved.addListener.mock.calls[0][0];
    await onRemovedListener(42);

    // Session and override should both be cleaned up
    expect(mod.__test__.getSession('browser:manual')).toBeNull();
    expect(mod.__test__.workspaceTimeoutOverrides.has('browser:manual')).toBe(false);
    // Should fall back to default interactive timeout
    expect(mod.__test__.getIdleTimeout('browser:manual')).toBe(600_000);
  });
});
