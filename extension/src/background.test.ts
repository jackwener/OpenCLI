import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener<T extends (...args: any[]) => void> = {
  addListener: any;
  removeListener?: any;
};

type MockTab = {
  id: number;
  windowId: number;
  url?: string;
  title?: string;
  active?: boolean;
  status?: string;
  groupId?: number;
};

type MockTabGroup = {
  id: number;
  windowId: number;
  title?: string;
  color?: chrome.tabGroups.ColorEnum;
  collapsed?: boolean;
};

const leaseKey = (surface: 'browser' | 'adapter', session: string): string =>
  `${surface}\u0000${encodeURIComponent(session)}`;
const browserKey = (session: string): string => leaseKey('browser', session);
const adapterKey = (session: string): string => leaseKey('adapter', session);

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
  let nextGroupId = 100;
  const storageState: Record<string, unknown> = {};
  const tabs: MockTab[] = [
    { id: 1, windowId: 1, url: 'https://automation.example', title: 'automation', active: true, status: 'complete', groupId: -1 },
    { id: 2, windowId: 2, url: 'https://user.example', title: 'user', active: true, status: 'complete', groupId: -1 },
    { id: 3, windowId: 1, url: 'chrome://extensions', title: 'chrome', active: false, status: 'complete', groupId: -1 },
  ];
  const groups: MockTabGroup[] = [];
  let lastFocusedWindowId = 2;

  const query = vi.fn(async (queryInfo: { windowId?: number; active?: boolean; lastFocusedWindow?: boolean } = {}) => {
    return tabs.filter((tab) => {
      if (queryInfo.windowId !== undefined && tab.windowId !== queryInfo.windowId) return false;
      if (queryInfo.lastFocusedWindow && tab.windowId !== lastFocusedWindowId) return false;
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
      groupId: -1,
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
      group: vi.fn(async (options: { tabIds?: number | number[]; groupId?: number; createProperties?: { windowId?: number } }) => {
        const tabIds = Array.isArray(options.tabIds) ? options.tabIds : [options.tabIds].filter((id): id is number => typeof id === 'number');
        let groupId = options.groupId;
        if (groupId === undefined) {
          groupId = nextGroupId++;
          groups.push({
            id: groupId,
            windowId: options.createProperties?.windowId ?? tabs.find((tab) => tab.id === tabIds[0])?.windowId ?? 1,
            collapsed: false,
          });
        }
        for (const tabId of tabIds) {
          const tab = tabs.find((entry) => entry.id === tabId);
          if (!tab) throw new Error(`Unknown tab ${tabId}`);
          tab.groupId = groupId;
        }
        return groupId;
      }),
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() } as Listener<(id: number, info: chrome.tabs.TabChangeInfo) => void>,
      onRemoved: { addListener: vi.fn() } as Listener<(tabId: number) => void>,
    },
    tabGroups: {
      TAB_GROUP_ID_NONE: -1,
      get: vi.fn(async (groupId: number) => {
        const group = groups.find((entry) => entry.id === groupId);
        if (!group) throw new Error(`Unknown group ${groupId}`);
        return group;
      }),
      query: vi.fn(async (queryInfo: { windowId?: number; title?: string } = {}) => groups.filter((group) => {
        if (queryInfo.windowId !== undefined && group.windowId !== queryInfo.windowId) return false;
        if (queryInfo.title !== undefined && group.title !== queryInfo.title) return false;
        return true;
      })),
      update: vi.fn(async (groupId: number, updates: { title?: string; color?: chrome.tabGroups.ColorEnum; collapsed?: boolean }) => {
        const group = groups.find((entry) => entry.id === groupId);
        if (!group) throw new Error(`Unknown group ${groupId}`);
        Object.assign(group, updates);
        return group;
      }),
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
      clear: vi.fn(),
      onAlarm: { addListener: vi.fn() } as Listener<(alarm: { name: string }) => void>,
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storageState[key] })),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(storageState, items);
        }),
      },
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

  return { chrome, tabs, groups, query, create, update };
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
    mod.__test__.setAutomationWindowId(adapterKey('twitter'), 1);

    const result = await mod.__test__.handleTabs({ id: '1', action: 'tabs', op: 'list', session: adapterKey('twitter') }, adapterKey('twitter'));

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
    mod.__test__.setAutomationWindowId(adapterKey('twitter'), 1);

    const result = await mod.__test__.handleCommand({ id: 'frames', action: 'frames', session: 'twitter', surface: 'adapter' });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([
      { index: 0, frameId: 'cross-origin-nested', url: 'https://x.example/widget', name: 'nested-x' },
      { index: 1, frameId: 'cross-origin-sibling', url: 'https://y.example/iframe', name: 'sibling-y' },
    ]);
  });

  it('allows Accessibility.enable through the guarded CDP passthrough', async () => {
    const { chrome } = createChromeMock();
    chrome.debugger.sendCommand = vi.fn(async () => ({}));
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId(adapterKey('twitter'), 1);

    const result = await mod.__test__.handleCommand({
      id: 'ax-enable',
      action: 'cdp',
      session: 'twitter',
      surface: 'adapter',
      cdpMethod: 'Accessibility.enable',
      cdpParams: {},
    });

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(chrome.debugger.sendCommand).toHaveBeenCalledWith(
      { tabId: 1 },
      'Accessibility.enable',
      {},
    );
  });

  it('routes frame-target CDP passthrough calls through the iframe target', async () => {
    const { chrome } = createChromeMock();
    chrome.debugger.sendCommand = vi.fn(async (_target: unknown, method: string, params?: Record<string, unknown>) => {
      if (method === 'Runtime.evaluate') return { result: { value: 1 } };
      if (method === 'Target.attachToTarget') return { sessionId: 'session-1' };
      if (method === 'Target.sendMessageToTarget') return {};
      return {};
    });
    vi.stubGlobal('chrome', chrome);

    const sendCommandInFrameTarget = vi.fn(async () => ({ nodes: [] }));
    vi.doMock('./cdp', () => ({
      registerListeners: vi.fn(),
      registerFrameTracking: vi.fn(),
      hasActiveNetworkCapture: vi.fn(() => false),
      detach: vi.fn(async () => {}),
      ensureAttached: vi.fn(async () => {}),
      sendCommandInFrameTarget,
    }));

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId(adapterKey('twitter'), 1);

    const result = await mod.__test__.handleCommand({
      id: 'frame-ax',
      action: 'cdp',
      session: 'twitter',
      surface: 'adapter',
      cdpMethod: 'Accessibility.getFullAXTree',
      cdpParams: { frameId: 'cross-frame', sessionId: 'target', targetUrl: 'https://frame.test/' },
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      data: expect.objectContaining({ nodes: [] }),
    }));
    expect(sendCommandInFrameTarget).toHaveBeenCalledWith(
      1,
      'cross-frame',
      'Accessibility.getFullAXTree',
      {},
      false,
      30_000,
      'https://frame.test/',
    );
  });

  it('routes wait-download commands to the download observer', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);
    const waitForDownload = vi.fn(async () => ({
      downloaded: true,
      filename: '/tmp/receipt.pdf',
      state: 'complete',
      elapsedMs: 12,
    }));
    vi.doMock('./cdp', () => ({
      registerListeners: vi.fn(),
      registerFrameTracking: vi.fn(),
      hasActiveNetworkCapture: vi.fn(() => false),
      detach: vi.fn(async () => {}),
      waitForDownload,
    }));

    const mod = await import('./background');
    const result = await mod.__test__.handleCommand({
      id: 'download',
      action: 'wait-download',
      pattern: 'receipt',
      timeoutMs: 1234,
      session: 'mercury',
      surface: 'adapter',
    });

    expect(result).toEqual({
      id: 'download',
      ok: true,
      data: {
        downloaded: true,
        filename: '/tmp/receipt.pdf',
        state: 'complete',
        elapsedMs: 12,
      },
    });
    expect(waitForDownload).toHaveBeenCalledWith('receipt', 1234);
  });

  it('routes exec frameIndex through the same cross-origin frame ordering as handleFrames', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const evaluateInFrame = vi.fn(async () => 'frame-result');
    vi.doMock('./cdp', () => ({
      registerListeners: vi.fn(),
      registerFrameTracking: vi.fn(),
      hasActiveNetworkCapture: vi.fn(() => false),
      detach: vi.fn(async () => {}),
      evaluateAsync: vi.fn(async () => 'main-result'),
      evaluateInFrame,
      getFrameTree: vi.fn(async () => ({
        frameTree: {
          frame: { id: 'root', url: 'https://main.example/' },
          childFrames: [
            {
              frame: { id: 'same-origin-parent', url: 'https://main.example/embed' },
              childFrames: [
                { frame: { id: 'cross-origin-nested', url: 'https://x.example/widget', name: 'nested-x' } },
              ],
            },
            {
              frame: { id: 'cross-origin-sibling', url: 'https://y.example/iframe', name: 'sibling-y' },
            },
          ],
        },
      })),
      screenshot: vi.fn(),
      setFileInputFiles: vi.fn(),
      insertText: vi.fn(),
      startNetworkCapture: vi.fn(),
      readNetworkCapture: vi.fn(async () => []),
      ensureAttached: vi.fn(),
    }));

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId(adapterKey('twitter'), 1);

    const listResult = await mod.__test__.handleCommand({ id: 'frames', action: 'frames', session: 'twitter', surface: 'adapter' });
    const execResult = await mod.__test__.handleCommand({
      id: 'exec-in-frame',
      action: 'exec',
      code: 'document.title',
      frameIndex: 0,
      session: 'twitter',
      surface: 'adapter',
    });

    expect(listResult.ok).toBe(true);
    expect(listResult.data).toEqual([
      { index: 0, frameId: 'cross-origin-nested', url: 'https://x.example/widget', name: 'nested-x' },
      { index: 1, frameId: 'cross-origin-sibling', url: 'https://y.example/iframe', name: 'sibling-y' },
    ]);
    expect(execResult.ok).toBe(true);
    expect(evaluateInFrame).toHaveBeenCalledWith(1, 'document.title', 'cross-origin-nested', false);
  });

  it('creates new tabs inside the automation container', async () => {
    const { chrome, create } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId(adapterKey('twitter'), 1);

    const result = await mod.__test__.handleTabs({ id: '2', action: 'tabs', op: 'new', url: 'https://new.example', session: adapterKey('twitter') }, adapterKey('twitter'));

    expect(result.ok).toBe(true);
    expect(create).toHaveBeenCalledWith({ windowId: 1, url: 'https://new.example', active: true });
  });

  it('reuses the initial container tab for first tab-new lease instead of leaving a blank tab', async () => {
    const { chrome, create, update } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    const result = await mod.__test__.handleTabs(
      { id: 'first-new', action: 'tabs', op: 'new', url: 'https://first.example', session: browserKey('default') },
      browserKey('default'),
    );

    expect(result.ok).toBe(true);
    expect(chrome.windows.create).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://first.example' }));
    expect(update).toHaveBeenCalledWith(1, { url: 'https://first.example' });
    expect(create).not.toHaveBeenCalled();
  });

  it('closes a tab by page identity', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId(adapterKey('twitter'), 1);

    const result = await mod.__test__.handleTabs(
      { id: 'close-by-page', action: 'tabs', op: 'close', session: adapterKey('twitter'), page: 'target-1' },
      adapterKey('twitter'),
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
    mod.__test__.setAutomationWindowId(adapterKey('twitter'), 1);

    const result = await mod.__test__.handleNavigate(
      { id: 'same-url', action: 'navigate', url: 'https://www.bilibili.com', session: adapterKey('twitter') },
      adapterKey('twitter'),
    );

    expect(result).toEqual({
      id: 'same-url',
      ok: true,
      page: 'target-1',
      data: {
        title: 'bilibili',
        url: 'https://www.bilibili.com/',
        timedOut: false,
        session: 'twitter',
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
    mod.__test__.setAutomationWindowId(adapterKey('twitter'), 1);

    const result = await mod.__test__.handleNavigate(
      { id: 'capture-nav', action: 'navigate', url: 'https://eos.douyin.com/livesite/live/current', session: adapterKey('twitter') },
      adapterKey('twitter'),
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

  it('reports sessions per session', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId(adapterKey('twitter'), 1);
    mod.__test__.setAutomationWindowId(adapterKey('zhihu'), 2);

    const result = await mod.__test__.handleSessions({ id: '3', action: 'sessions' });
    expect(result.ok).toBe(true);
    expect(result.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ session: 'twitter', surface: 'adapter', windowId: 1 }),
      expect.objectContaining({ session: 'zhihu', surface: 'adapter', windowId: 2 }),
    ]));
  });

  it('returns the persisted profile contextId from popup status', async () => {
    const { chrome } = createChromeMock();
    await chrome.storage.local.set({ opencli_context_id_v1: 'abc123xy' });
    vi.stubGlobal('chrome', chrome);

    await import('./background');
    const onMessageListener = chrome.runtime.onMessage.addListener.mock.calls[0][0];
    const sendResponse = vi.fn();

    const keepAlive = onMessageListener({ type: 'getStatus' }, {}, sendResponse);

    expect(keepAlive).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({
        contextId: 'abc123xy',
      }));
    });
  });

  it('can execute concurrently on two pages in the same session', async () => {
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
    mod.__test__.setAutomationWindowId(adapterKey('twitter'), 1);

    const [first, second] = await Promise.all([
      mod.__test__.handleExec({ id: 'p1', action: 'exec', session: adapterKey('twitter'), page: 'target-1', code: 'window.__task = 1' }, adapterKey('twitter')),
      mod.__test__.handleExec({ id: 'p2', action: 'exec', session: adapterKey('twitter'), page: 'target-4', code: 'window.__task = 2' }, adapterKey('twitter')),
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

  it('can execute concurrently across two sessions in the shared container window', async () => {
    const { chrome, create } = createChromeMock();
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
    mod.__test__.setAutomationWindowId(adapterKey('twitter'), 1);
    mod.__test__.setAutomationWindowId(adapterKey('zhihu'), 2);

    const [first, second] = await Promise.all([
      mod.__test__.handleExec({ id: 'w1', action: 'exec', session: adapterKey('twitter'), code: 'window.__window = 1' }, adapterKey('twitter')),
      mod.__test__.handleExec({ id: 'w2', action: 'exec', session: adapterKey('zhihu'), code: 'window.__window = 2' }, adapterKey('zhihu')),
    ]);

    expect(first).toEqual(expect.objectContaining({
      ok: true,
      page: 'target-1',
      data: expect.objectContaining({ tabId: 1, code: 'window.__window = 1' }),
    }));
    expect(second).toEqual(expect.objectContaining({
      ok: true,
      page: 'target-10',
      data: expect.objectContaining({ tabId: 10, code: 'window.__window = 2' }),
    }));
    expect(maxInFlight).toBe(2);
    expect(chrome.windows.create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({ windowId: 1, url: 'about:blank', active: true });
  });

  it('releases owned sessions without closing the shared container', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    await mod.__test__.resolveTabId(undefined, adapterKey('first'));
    await mod.__test__.resolveTabId(undefined, adapterKey('second'));
    expect(mod.__test__.getSession(adapterKey('second'))).toEqual(expect.objectContaining({ preferredTabId: 10 }));

    const closeSecond = await mod.__test__.handleCommand({ id: 'close-second', action: 'close-window', session: 'second', surface: 'adapter' });
    expect(closeSecond).toEqual(expect.objectContaining({ ok: true }));
    expect(chrome.tabs.remove).toHaveBeenCalledWith(10);
    expect(chrome.tabs.update).not.toHaveBeenCalledWith(10, { url: 'about:blank', active: true });
    expect(chrome.windows.remove).not.toHaveBeenCalled();
    expect(mod.__test__.getSession(adapterKey('first'))).not.toBeNull();
    expect(mod.__test__.getSession(adapterKey('second'))).toBeNull();

    await mod.__test__.handleCommand({ id: 'close-first', action: 'close-window', session: 'first', surface: 'adapter' });
    expect(chrome.tabs.update).toHaveBeenCalledWith(1, { url: 'about:blank' });
    expect(chrome.windows.remove).not.toHaveBeenCalled();
  });

  it('releases the current owned tab lease when tabs close targets it', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    await mod.__test__.resolveTabId(undefined, adapterKey('twitter'));

    const result = await mod.__test__.handleTabs(
      { id: 'close-current-lease', action: 'tabs', op: 'close', session: adapterKey('twitter') },
      adapterKey('twitter'),
    );

    expect(result).toEqual(expect.objectContaining({
      id: 'close-current-lease',
      ok: true,
      data: { closed: 'target-1' },
    }));
    expect(chrome.tabs.update).toHaveBeenCalledWith(1, { url: 'about:blank', active: true });
    expect(chrome.windows.remove).not.toHaveBeenCalled();
    expect(mod.__test__.getSession(adapterKey('twitter'))).toBeNull();
  });

  it('reconciles an owned container with no stored leases without closing it', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);
    await chrome.storage.local.set({
      opencli_target_lease_registry_v2: {
        version: 2,
        contextId: 'user-default',
        ownedContainers: { interactive: { windowId: null }, automation: { windowId: 1 } },
        leases: {},
      },
    });

    const mod = await import('./background');
    await mod.__test__.reconcileTargetLeaseRegistry();

    expect(chrome.windows.remove).not.toHaveBeenCalled();
    expect(mod.__test__.getAutomationWindowId()).toBeNull();
    chrome.windows.create.mockClear();

    const tabId = await mod.__test__.resolveTabId(undefined, adapterKey('twitter'), 'https://after.example');

    expect(tabId).toBe(1);
    expect(chrome.windows.create).not.toHaveBeenCalled();
    expect(chrome.tabs.update).toHaveBeenCalledWith(1, { url: 'https://after.example' });
  });

  it('restores owned and borrowed leases from the registry', async () => {
    const { chrome } = createChromeMock();
    const deadline = Date.now() + 30_000;
    vi.stubGlobal('chrome', chrome);
    await chrome.storage.local.set({
      opencli_target_lease_registry_v2: {
        version: 2,
        contextId: 'user-default',
        ownedContainers: { interactive: { windowId: null }, automation: { windowId: 1 } },
        leases: {
          [adapterKey('twitter')]: {
            windowId: 1,
            owned: true,
            preferredTabId: 1,
            contextId: 'user-default',
            ownership: 'owned',
            lifecycle: 'ephemeral',
            windowRole: 'automation',
            idleDeadlineAt: deadline,
            updatedAt: Date.now(),
          },
          [browserKey('default')]: {
            windowId: 2,
            owned: false,
            preferredTabId: 2,
            contextId: 'user-default',
            ownership: 'borrowed',
            lifecycle: 'pinned',
            windowRole: 'borrowed-user',
            idleDeadlineAt: 0,
            updatedAt: Date.now(),
          },
        },
      },
    });

    const mod = await import('./background');
    await mod.__test__.reconcileTargetLeaseRegistry();

    expect(mod.__test__.getSession(adapterKey('twitter'))).toEqual(expect.objectContaining({
      owned: true,
      ownership: 'owned',
      lifecycle: 'ephemeral',
      windowRole: 'automation',
      preferredTabId: 1,
    }));
    expect(mod.__test__.getSession(browserKey('default'))).toEqual(expect.objectContaining({
      owned: false,
      ownership: 'borrowed',
      lifecycle: 'pinned',
      windowRole: 'borrowed-user',
      preferredTabId: 2,
      idleTimer: null,
      idleDeadlineAt: 0,
    }));
    expect(chrome.alarms.create).toHaveBeenCalledWith(
      `opencli:lease-idle:${encodeURIComponent(adapterKey('twitter'))}`,
      expect.objectContaining({ when: expect.any(Number) }),
    );
    expect(chrome.windows.remove).not.toHaveBeenCalled();
  });

  it('releases owned leases from the idle alarm path', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    await mod.__test__.resolveTabId(undefined, adapterKey('alarm'));

    const onAlarmListener = chrome.alarms.onAlarm.addListener.mock.calls[0][0];
    await onAlarmListener({ name: `opencli:lease-idle:${encodeURIComponent(adapterKey('alarm'))}` });

    expect(chrome.tabs.update).toHaveBeenCalledWith(1, { url: 'about:blank' });
    expect(chrome.windows.remove).not.toHaveBeenCalled();
    expect(mod.__test__.getSession(adapterKey('alarm'))).toBeNull();
  });

  it('reuses the placeholder tab left by an idle release', async () => {
    const { chrome, tabs } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    await mod.__test__.resolveTabId(undefined, adapterKey('first'));

    const onAlarmListener = chrome.alarms.onAlarm.addListener.mock.calls[0][0];
    await onAlarmListener({ name: `opencli:lease-idle:${encodeURIComponent(adapterKey('first'))}` });

    expect(tabs[0].url).toBe('about:blank');
    expect(chrome.windows.remove).not.toHaveBeenCalled();
    chrome.windows.create.mockClear();

    const reused = await mod.__test__.resolveTabId(undefined, adapterKey('next'), 'https://next.example');

    expect(reused).toBe(1);
    expect(chrome.windows.create).not.toHaveBeenCalled();
    expect(chrome.tabs.update).toHaveBeenCalledWith(1, { url: 'https://next.example' });
  });

  it('deduplicates concurrent automation container creation', async () => {
    const { chrome } = createChromeMock();
    chrome.windows.get = vi.fn(async (windowId: number) => {
      if (windowId === 90 || windowId === 91) throw new Error(`stale window ${windowId}`);
      return { id: windowId };
    });
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setSession(adapterKey('stale-a'), { windowId: 90, owned: true, preferredTabId: null });
    mod.__test__.setSession(adapterKey('stale-b'), { windowId: 91, owned: true, preferredTabId: null });

    const [first, second] = await Promise.all([
      mod.__test__.handleTabs({ id: 'new-a', action: 'tabs', op: 'new', session: adapterKey('stale-a'), url: 'https://a.example' }, adapterKey('stale-a')),
      mod.__test__.handleTabs({ id: 'new-b', action: 'tabs', op: 'new', session: adapterKey('stale-b'), url: 'https://b.example' }, adapterKey('stale-b')),
    ]);

    expect(first).toEqual(expect.objectContaining({ ok: true }));
    expect(second).toEqual(expect.objectContaining({ ok: true }));
    expect(chrome.windows.create).toHaveBeenCalledTimes(1);
  });

  it('marks a newly created owned automation window with an OpenCLI Adapter tab group', async () => {
    const { chrome, tabs, groups } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    const tabId = await mod.__test__.resolveTabId(undefined, adapterKey('twitter'));

    expect(tabId).toBe(1);
    expect(tabs[0].groupId).toBe(100);
    expect(groups).toEqual([
      expect.objectContaining({
        id: 100,
        windowId: 1,
        title: 'OpenCLI Adapter',
        color: 'orange',
        collapsed: false,
      }),
    ]);
    expect(chrome.tabs.group).toHaveBeenCalledWith({ tabIds: [1], createProperties: { windowId: 1 } });
  });

  it('uses separate owned windows for browser and adapter sessions', async () => {
    const { chrome, tabs, groups } = createChromeMock();
    let nextWindowId = 20;
    let nextTabId = 200;
    chrome.windows.create = vi.fn(async ({ url, focused, width, height, type }: any) => {
      const windowId = nextWindowId++;
      const tab: MockTab = {
        id: nextTabId++,
        windowId,
        url,
        title: url ?? 'blank',
        active: true,
        status: 'complete',
        groupId: -1,
      };
      tabs.push(tab);
      return { id: windowId, url, focused, width, height, type };
    });
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    const browserTabId = await mod.__test__.resolveTabId(undefined, browserKey('default'));
    const adapterTabId = await mod.__test__.resolveTabId(undefined, adapterKey('twitter'));

    expect(tabs.find((tab) => tab.id === browserTabId)?.windowId).toBe(20);
    expect(tabs.find((tab) => tab.id === adapterTabId)?.windowId).toBe(21);
    expect(chrome.windows.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ focused: true }));
    expect(chrome.windows.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ focused: false }));
    expect(groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ windowId: 20, title: 'OpenCLI Browser' }),
      expect.objectContaining({ windowId: 21, title: 'OpenCLI Adapter' }),
    ]));
  });

  it('lets adapters explicitly request a foreground automation window', async () => {
    const { chrome, tabs } = createChromeMock();
    let nextWindowId = 30;
    let nextTabId = 300;
    chrome.windows.create = vi.fn(async ({ url, focused, width, height, type }: any) => {
      const windowId = nextWindowId++;
      tabs.push({
        id: nextTabId++,
        windowId,
        url,
        title: url ?? 'blank',
        active: true,
        status: 'complete',
        groupId: -1,
      });
      return { id: windowId, url, focused, width, height, type };
    });
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    const result = await mod.__test__.handleCommand({
      id: 'new-foreground',
      action: 'tabs',
      op: 'new',
      session: adapterKey('twitter'),
      url: 'https://x.com',
      windowMode: 'foreground',
    });

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(chrome.windows.create).toHaveBeenCalledWith(expect.objectContaining({ focused: true }));
  });

  it('reuses the existing adapter tab group when adding another owned lease tab', async () => {
    const { chrome, tabs, groups } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    await mod.__test__.resolveTabId(undefined, adapterKey('first'));
    const secondTabId = await mod.__test__.resolveTabId(undefined, adapterKey('second'));

    expect(secondTabId).toBe(10);
    expect(groups).toHaveLength(1);
    expect(tabs.find((tab) => tab.id === 10)?.groupId).toBe(100);
    expect(chrome.tabs.group).toHaveBeenCalledWith({ groupId: 100, tabIds: [10] });
  });

  it('discovers and reuses an existing OpenCLI Adapter group after service worker restart', async () => {
    const { chrome, tabs, groups } = createChromeMock();
    groups.push({
      id: 99,
      windowId: 1,
      title: 'OpenCLI Adapter',
      color: 'orange',
      collapsed: true,
    });
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    const tabId = await mod.__test__.resolveTabId(undefined, adapterKey('twitter'));

    expect(tabId).toBe(1);
    expect(tabs[0].groupId).toBe(99);
    expect(groups).toHaveLength(1);
    expect(chrome.tabs.group).toHaveBeenCalledWith({ groupId: 99, tabIds: [1] });
    expect(chrome.tabGroups.update).not.toHaveBeenCalled();
  });

  it('reuses a persisted automation group id after service worker restart even if the user renamed it', async () => {
    const { chrome, tabs, groups } = createChromeMock();
    groups.push({
      id: 99,
      windowId: 1,
      title: 'My Automation',
      color: 'cyan',
      collapsed: true,
    });
    vi.stubGlobal('chrome', chrome);
    await chrome.storage.local.set({
      opencli_target_lease_registry_v2: {
        version: 2,
        contextId: 'user-default',
        ownedContainers: { interactive: { windowId: null }, automation: { windowId: 1, groupId: 99 } },
        leases: {
          [adapterKey('twitter')]: {
            windowId: 1,
            owned: true,
            preferredTabId: 1,
            contextId: 'user-default',
            ownership: 'owned',
            lifecycle: 'ephemeral',
            windowRole: 'automation',
            idleDeadlineAt: Date.now() + 30_000,
            updatedAt: Date.now(),
          },
        },
      },
    });

    const mod = await import('./background');
    await mod.__test__.reconcileTargetLeaseRegistry();

    expect(tabs[0].groupId).toBe(99);
    expect(groups).toEqual([
      expect.objectContaining({
        id: 99,
        title: 'My Automation',
        color: 'cyan',
        collapsed: true,
      }),
    ]);
    expect(chrome.tabs.group).toHaveBeenCalledWith({ groupId: 99, tabIds: [1] });
    expect(chrome.tabGroups.update).not.toHaveBeenCalled();
  });

  it('falls back to title discovery when a persisted automation group id is stale', async () => {
    const { chrome, tabs, groups } = createChromeMock();
    groups.push({
      id: 99,
      windowId: 1,
      title: 'OpenCLI Adapter',
      color: 'orange',
      collapsed: true,
    });
    vi.stubGlobal('chrome', chrome);
    await chrome.storage.local.set({
      opencli_target_lease_registry_v2: {
        version: 2,
        contextId: 'user-default',
        ownedContainers: { interactive: { windowId: null }, automation: { windowId: 1, groupId: 404 } },
        leases: {
          [adapterKey('twitter')]: {
            windowId: 1,
            owned: true,
            preferredTabId: 1,
            contextId: 'user-default',
            ownership: 'owned',
            lifecycle: 'ephemeral',
            windowRole: 'automation',
            idleDeadlineAt: Date.now() + 30_000,
            updatedAt: Date.now(),
          },
        },
      },
    });

    const mod = await import('./background');
    await mod.__test__.reconcileTargetLeaseRegistry();

    expect(tabs[0].groupId).toBe(99);
    expect(groups).toHaveLength(1);
    expect(chrome.tabs.group).toHaveBeenCalledWith({ groupId: 99, tabIds: [1] });
    expect(chrome.tabGroups.update).not.toHaveBeenCalled();
  });

  it('does not group borrowed user tabs for bound sessions', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    const result = await mod.__test__.handleBind(
      { id: 'bind', action: 'bind', session: browserKey('default') },
      browserKey('default'),
    );

    expect(result.ok).toBe(true);
    expect(chrome.tabs.group).not.toHaveBeenCalled();
    expect(chrome.tabGroups.update).not.toHaveBeenCalled();
  });

  it('keeps adapter:notebooklm inside its owned automation lease instead of rebinding to a user tab', async () => {
    const { chrome, tabs } = createChromeMock();
    tabs[0].url = 'https://notebooklm.google.com/';
    tabs[0].title = 'NotebookLM Home';
    tabs[1].url = 'https://notebooklm.google.com/notebook/nb-live';
    tabs[1].title = 'Live Notebook';
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId(adapterKey('twitter'), 1);

    const tabId = await mod.__test__.resolveTabId(undefined, adapterKey('twitter'));

    expect(tabId).toBe(1);
    expect(mod.__test__.getSession(adapterKey('twitter'))).toEqual(expect.objectContaining({
      windowId: 1,
    }));
  });

  it('moves drifted legacy tab back to its automation container instead of creating a new one', async () => {
    const { chrome, tabs } = createChromeMock();
    // Tab 1 belongs to automation container 1 but drifted to window 2
    tabs[0].windowId = 2;
    tabs[0].url = 'https://twitter.com/home';
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId(adapterKey('twitter'), 1);

    const tabId = await mod.__test__.resolveTabId(1, adapterKey('twitter'));

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
    mod.__test__.setAutomationWindowId(adapterKey('twitter'), 1);

    // Should still resolve (by finding/creating a tab in the correct window)
    const tabId = await mod.__test__.resolveTabId(1, adapterKey('twitter'));
    expect(typeof tabId).toBe('number');
  });

  it('idle timeout releases the automation lease for adapter:notebooklm', async () => {
    const { chrome, tabs } = createChromeMock();
    tabs[0].url = 'https://notebooklm.google.com/';
    tabs[0].title = 'NotebookLM Home';
    tabs[0].active = true;

    vi.useFakeTimers();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId(adapterKey('twitter'), 1);

    mod.__test__.resetWindowIdleTimer(adapterKey('twitter'));
    await vi.advanceTimersByTimeAsync(30001);

    expect(chrome.windows.remove).not.toHaveBeenCalled();
    expect(mod.__test__.getSession(adapterKey('twitter'))).toBeNull();
  });

  it('keeps persistent adapter site sessions alive across adapter idle timeout', async () => {
    const { chrome, tabs } = createChromeMock();
    tabs[0].url = 'https://chatgpt.com/';
    tabs[0].title = 'ChatGPT';
    tabs[0].active = true;

    vi.useFakeTimers();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');

    const first = await mod.__test__.handleCommand({
      id: 'persistent-nav-1',
      action: 'navigate',
      session: 'chatgpt',
      surface: 'adapter',
      siteSession: 'persistent',
      url: 'https://chatgpt.com/',
    });
    expect(first.ok).toBe(true);
    const page = first.page;

    const session = mod.__test__.getSession(adapterKey('chatgpt'));
    expect(session).toEqual(expect.objectContaining({
      lifecycle: 'persistent',
      surface: 'adapter',
      session: 'chatgpt',
    }));
    expect(mod.__test__.getIdleTimeout(adapterKey('chatgpt'))).toBe(-1);

    await vi.advanceTimersByTimeAsync(60001);
    expect(mod.__test__.getSession(adapterKey('chatgpt'))).not.toBeNull();

    const second = await mod.__test__.handleCommand({
      id: 'persistent-nav-2',
      action: 'navigate',
      session: 'chatgpt',
      surface: 'adapter',
      siteSession: 'persistent',
      url: 'https://chatgpt.com/',
    });
    expect(second.ok).toBe(true);
    expect(second.page).toBe(page);
    expect(mod.__test__.getSession(adapterKey('chatgpt'))).not.toBeNull();
  });

  it('uses 10-minute timeout for browser:* sessions', async () => {
    const { chrome } = createChromeMock();
    vi.useFakeTimers();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId(browserKey('default'), 1);

    mod.__test__.resetWindowIdleTimer(browserKey('default'));
    // After 30s (adapter timeout), session should still be alive
    await vi.advanceTimersByTimeAsync(30001);
    expect(mod.__test__.getSession(browserKey('default'))).not.toBeNull();

    // After 10 min total, session should be cleaned up
    await vi.advanceTimersByTimeAsync(600000 - 30001);
    expect(chrome.windows.remove).not.toHaveBeenCalled();
    expect(mod.__test__.getSession(browserKey('default'))).toBeNull();
  });

  it('clears sessionTimeoutOverrides on idle expiry', async () => {
    const { chrome } = createChromeMock();
    vi.useFakeTimers();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId(browserKey('default'), 1);

    // Set a custom timeout override
    mod.__test__.sessionTimeoutOverrides.set(browserKey('default'), 120_000);
    expect(mod.__test__.getIdleTimeout(browserKey('default'))).toBe(120_000);

    // Trigger idle timer with the custom timeout
    mod.__test__.resetWindowIdleTimer(browserKey('default'));
    await vi.advanceTimersByTimeAsync(120001);

    // Override should be cleaned up
    expect(mod.__test__.sessionTimeoutOverrides.has(browserKey('default'))).toBe(false);
    expect(mod.__test__.getSession(browserKey('default'))).toBeNull();
    // Should fall back to default interactive timeout
    expect(mod.__test__.getIdleTimeout(browserKey('default'))).toBe(600_000);
  });

  it('clears sessionTimeoutOverrides on explicit close', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId(browserKey('default'), 1);
    mod.__test__.sessionTimeoutOverrides.set(browserKey('default'), 300_000);

    const result = await mod.__test__.handleCommand({
      id: 'close-1',
      action: 'close-window',
      session: browserKey('default'),
    });

    expect(result.ok).toBe(true);
    expect(mod.__test__.sessionTimeoutOverrides.has(browserKey('default'))).toBe(false);
  });

  it('applies idleTimeout from command to session override', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId(browserKey('default'), 1);

    // Default for browser:* is 10 min
    expect(mod.__test__.getIdleTimeout(browserKey('default'))).toBe(600_000);

    // Send a command with custom idleTimeout (in seconds)
    await mod.__test__.handleCommand({
      id: 'custom-1',
      action: 'sessions',
      session: browserKey('default'),
      idleTimeout: 120,
    });

    // Override should now be 120s = 120000ms
    expect(mod.__test__.getIdleTimeout(browserKey('default'))).toBe(120_000);
  });

  it('clears sessionTimeoutOverrides when user manually closes the automation container', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');

    // Set up a session with window ID 42 and a custom timeout override
    mod.__test__.setAutomationWindowId(browserKey('default'), 42);
    mod.__test__.sessionTimeoutOverrides.set(browserKey('default'), 180_000);
    expect(mod.__test__.getIdleTimeout(browserKey('default'))).toBe(180_000);

    // Simulate user closing the window — invoke the onRemoved listener
    const onRemovedListener = chrome.windows.onRemoved.addListener.mock.calls[0][0];
    await onRemovedListener(42);

    // Session and override should both be cleaned up
    expect(mod.__test__.getSession(browserKey('default'))).toBeNull();
    expect(mod.__test__.sessionTimeoutOverrides.has(browserKey('default'))).toBe(false);
    // Should fall back to default interactive timeout
    expect(mod.__test__.getIdleTimeout(browserKey('default'))).toBe(600_000);
  });


  it('bind does not reach into background windows when the current window has no match', async () => {
    const { chrome, tabs } = createChromeMock();
    tabs[1].url = 'chrome://extensions';
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');

    const result = await mod.__test__.handleBind({
      id: 'bind-current-window-only',
      action: 'bind',
      session: browserKey('default'),
    }, browserKey('default'));

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      errorCode: 'bound_tab_not_found',
      error: expect.stringContaining('current window'),
    }));
    expect(mod.__test__.getSession(browserKey('default'))).toBeNull();
  });

  it('bind attaches the current tab to the named browser session', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');

    const bound = await mod.__test__.handleBind({
      id: 'bind-good',
      action: 'bind',
      session: 'default',
    }, browserKey('default'));

    expect(bound).toEqual(expect.objectContaining({
      ok: true,
      data: expect.objectContaining({ session: 'default', url: 'https://user.example' }),
    }));
    expect(mod.__test__.getSession(browserKey('default'))).toEqual(expect.objectContaining({
      windowId: 2,
      owned: false,
      preferredTabId: 2,
      idleTimer: null,
      idleDeadlineAt: 0,
    }));
    expect(chrome.windows.create).not.toHaveBeenCalled();
  });

  it('rebind releases an owned browser lease before binding the current user tab', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setAutomationWindowId(browserKey('default'), 1);

    const result = await mod.__test__.handleBind({
      id: 'bind-overwrite',
      action: 'bind',
      session: 'default',
    }, browserKey('default'));

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      data: expect.objectContaining({ session: 'default', url: 'https://user.example' }),
    }));
    expect(mod.__test__.getSession(browserKey('default'))).toEqual(expect.objectContaining({
      windowId: 2,
      owned: false,
      kind: 'bound',
    }));
  });

  it('keeps borrowed bound sessions alive without closing the user window on idle', async () => {
    const { chrome } = createChromeMock();
    vi.useFakeTimers();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setSession(browserKey('default'), { windowId: 2, owned: false, preferredTabId: 2 });

    expect(mod.__test__.getIdleTimeout(browserKey('default'))).toBe(-1);
    mod.__test__.resetWindowIdleTimer(browserKey('default'));
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(chrome.windows.remove).not.toHaveBeenCalled();
    expect(mod.__test__.getSession(browserKey('default'))).not.toBeNull();
  });

  it('explicit close on a borrowed bound session detaches without touching tabs or windows', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setSession(browserKey('default'), { windowId: 2, owned: false, preferredTabId: 2 });

    const result = await mod.__test__.handleCommand({
      id: 'bound-close',
      action: 'close-window',
      session: browserKey('default'),
    });

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
    expect(chrome.tabs.update).not.toHaveBeenCalled();
    expect(chrome.windows.remove).not.toHaveBeenCalled();
    expect(mod.__test__.getSession(browserKey('default'))).toBeNull();
  });

  it('cleans borrowed sessions when the bound tab is closed', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setSession(browserKey('default'), { windowId: 2, owned: false, preferredTabId: 2 });

    const onRemovedListener = chrome.tabs.onRemoved.addListener.mock.calls[0][0];
    onRemovedListener(2);

    expect(mod.__test__.getSession(browserKey('default'))).toBeNull();
    expect(chrome.windows.remove).not.toHaveBeenCalled();
  });

  it('fails closed when a borrowed bound tab is gone instead of creating an automation lease', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setSession(browserKey('default'), { windowId: 2, owned: false, preferredTabId: 999 });

    const result = await mod.__test__.handleCommand({
      id: 'bound-exec-gone',
      action: 'exec',
      session: browserKey('default'),
      code: 'document.title',
    });

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      errorCode: 'bound_tab_gone',
    }));
    expect(chrome.windows.create).not.toHaveBeenCalled();
  });

  it('fails closed when a borrowed bound tab is no longer debuggable', async () => {
    const { chrome, tabs } = createChromeMock();
    tabs[1].url = 'chrome://settings';
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./background');
    mod.__test__.setSession(browserKey('default'), { windowId: 2, owned: false, preferredTabId: 2 });

    const result = await mod.__test__.handleCommand({
      id: 'bound-exec-undebuggable',
      action: 'exec',
      session: browserKey('default'),
      code: 'document.title',
    });

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      errorCode: 'bound_tab_not_debuggable',
    }));
    expect(chrome.windows.create).not.toHaveBeenCalled();
  });

  it('allows navigation but blocks tab mutation on borrowed sessions', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);
    vi.doMock('./cdp', () => ({
      registerListeners: vi.fn(),
      registerFrameTracking: vi.fn(),
      hasActiveNetworkCapture: vi.fn(() => false),
      detach: vi.fn(async () => {}),
    }));

    const mod = await import('./background');
    mod.__test__.setSession(browserKey('default'), { windowId: 2, owned: false, preferredTabId: 2 });

    const nav = await mod.__test__.handleCommand({
      id: 'bound-nav',
      action: 'navigate',
      session: browserKey('default'),
      url: 'https://other.example',
    });
    const tabNew = await mod.__test__.handleCommand({
      id: 'bound-tab-new',
      action: 'tabs',
      session: browserKey('default'),
      op: 'new',
      url: 'https://other.example',
    });

    expect(nav).toEqual(expect.objectContaining({ ok: true }));
    expect(tabNew).toEqual(expect.objectContaining({
      ok: false,
      errorCode: 'bound_tab_mutation_blocked',
    }));
    expect(chrome.tabs.update).toHaveBeenCalledWith(2, expect.objectContaining({ url: 'https://other.example' }));
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });
});
