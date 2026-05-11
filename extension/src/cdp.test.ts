import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createChromeMock() {
  const debuggerEventListeners: Array<(source: { tabId?: number }, method: string, params: any) => void> = [];
  const tabRemovedListeners: Array<(tabId: number) => void> = [];
  const tabs = {
    get: vi.fn(async (_tabId: number) => ({
      id: 1,
      windowId: 1,
      url: 'https://x.com/home',
    })),
    onRemoved: { addListener: vi.fn((fn: (tabId: number) => void) => { tabRemovedListeners.push(fn); }) },
    onUpdated: { addListener: vi.fn() },
  };

  const debuggerApi = {
    attach: vi.fn(async () => {}),
    detach: vi.fn(async () => {}),
    sendCommand: vi.fn(async (_target: unknown, method: string) => {
      if (method === 'Runtime.evaluate') return { result: { value: 'ok' } };
      return {};
    }),
    onDetach: { addListener: vi.fn() },
    onEvent: { addListener: vi.fn((fn: (source: { tabId?: number }, method: string, params: any) => void) => { debuggerEventListeners.push(fn); }) },
  };

  const scripting = {
    executeScript: vi.fn(async () => [{ result: { removed: 1 } }]),
  };

  return {
    chrome: {
      tabs,
      debugger: debuggerApi,
      scripting,
      runtime: { id: 'opencli-test' },
    },
    debuggerApi,
    scripting,
    debuggerEventListeners,
    tabRemovedListeners,
  };
}

describe('cdp attach recovery', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not mutate the DOM before a successful attach', async () => {
    const { chrome, debuggerApi, scripting } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./cdp');
    const result = await mod.evaluate(1, '1');

    expect(result).toBe('ok');
    expect(debuggerApi.attach).toHaveBeenCalledTimes(1);
    expect(scripting.executeScript).not.toHaveBeenCalled();
  });

  it('uses the default execution context for a frame when isolated worlds also exist', async () => {
    const { chrome, debuggerApi, debuggerEventListeners } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./cdp');
    mod.registerFrameTracking();

    expect(debuggerEventListeners.length).toBeGreaterThanOrEqual(1);
    for (const listener of debuggerEventListeners) {
      listener(
        { tabId: 1 },
        'Runtime.executionContextCreated',
        { context: { id: 11, auxData: { frameId: 'frame-1', isDefault: false } } },
      );
      listener(
        { tabId: 1 },
        'Runtime.executionContextCreated',
        { context: { id: 22, auxData: { frameId: 'frame-1', isDefault: true } } },
      );
    }

    await mod.evaluateInFrame(1, 'document.title', 'frame-1');

    expect(debuggerApi.sendCommand).toHaveBeenCalledWith(
      { tabId: 1 },
      'Runtime.evaluate',
      expect.objectContaining({ contextId: 22 }),
    );
  });

  it('falls back to a frame target when no same-target execution context exists', async () => {
    const { chrome, debuggerApi, debuggerEventListeners } = createChromeMock();
    debuggerApi.sendCommand = vi.fn(async (target: any, method: string, _params?: any) => {
      if (method === 'Target.setDiscoverTargets') return {};
      if (method === 'Target.setAutoAttach') return {};
      if (method === 'Target.getTargets') return { targetInfos: [{ targetId: 'oopif-frame', type: 'iframe', url: 'https://frame.test' }] };
      if (target?.targetId === 'oopif-frame' && method === 'Runtime.enable') return {};
      if (target?.targetId === 'oopif-frame' && method === 'Runtime.evaluate') {
        return { result: { value: 'frame-ok' } };
      }
      if (method === 'Runtime.evaluate') return { result: { value: 'root-ok' } };
      return {};
    });
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./cdp');
    mod.registerFrameTracking();

    const result = await mod.evaluateInFrame(1, 'document.title', 'oopif-frame');

    expect(result).toBe('frame-ok');
    expect(debuggerApi.attach).toHaveBeenCalledWith({ targetId: 'oopif-frame' }, '1.3');
    expect(debuggerApi.sendCommand).toHaveBeenCalledWith(
      { targetId: 'oopif-frame' },
      'Runtime.evaluate',
      expect.any(Object),
    );
  });

});

function chromeMockForScreenshot(content: { width: number; height: number } = { width: 1024, height: 2048 }) {
  const calls: Array<{ method: string; params?: unknown }> = [];
  const debuggerApi = {
    attach: vi.fn(async () => {}),
    detach: vi.fn(async () => {}),
    sendCommand: vi.fn(async (_target: unknown, method: string, params?: unknown) => {
      calls.push({ method, params });
      if (method === 'Page.captureScreenshot') return { data: 'BASE64DATA' };
      if (method === 'Page.getLayoutMetrics') return { cssContentSize: content };
      return {};
    }),
    onDetach: { addListener: vi.fn() },
    onEvent: { addListener: vi.fn() },
  };
  const tabs = {
    get: vi.fn(async () => ({ id: 1, windowId: 1, url: 'https://example.com' })),
    onRemoved: { addListener: vi.fn() },
    onUpdated: { addListener: vi.fn() },
  };
  return {
    chrome: { tabs, debugger: debuggerApi, scripting: {}, runtime: { id: 'opencli-test' } },
    debuggerApi,
    calls,
  };
}

describe('cdp screenshot', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('takes a viewport screenshot without overriding device metrics by default', async () => {
    const { chrome, calls } = chromeMockForScreenshot();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./cdp');
    const data = await mod.screenshot(1);

    expect(data).toBe('BASE64DATA');
    const methods = calls.map((c) => c.method);
    expect(methods).not.toContain('Emulation.setDeviceMetricsOverride');
    expect(methods).not.toContain('Emulation.clearDeviceMetricsOverride');
    expect(methods).toContain('Page.captureScreenshot');
  });

  it('overrides only width when --width is given without --full-page', async () => {
    const { chrome, calls } = chromeMockForScreenshot();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./cdp');
    await mod.screenshot(1, { width: 1080 });

    const overrides = calls.filter((c) => c.method === 'Emulation.setDeviceMetricsOverride');
    expect(overrides).toHaveLength(1);
    expect(overrides[0].params).toEqual({ mobile: false, width: 1080, height: 0, deviceScaleFactor: 1 });
    expect(calls.some((c) => c.method === 'Page.getLayoutMetrics')).toBe(false);
    expect(calls.at(-1)?.method).toBe('Emulation.clearDeviceMetricsOverride');
  });

  it('overrides only height when --height is given without --full-page', async () => {
    const { chrome, calls } = chromeMockForScreenshot();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./cdp');
    await mod.screenshot(1, { height: 720 });

    const overrides = calls.filter((c) => c.method === 'Emulation.setDeviceMetricsOverride');
    expect(overrides).toHaveLength(1);
    expect(overrides[0].params).toEqual({ mobile: false, width: 0, height: 720, deviceScaleFactor: 1 });
    expect(calls.at(-1)?.method).toBe('Emulation.clearDeviceMetricsOverride');
  });

  it('uses content size for fullPage screenshots without explicit dimensions', async () => {
    const { chrome, calls } = chromeMockForScreenshot({ width: 1024, height: 2048 });
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./cdp');
    await mod.screenshot(1, { fullPage: true });

    const overrides = calls.filter((c) => c.method === 'Emulation.setDeviceMetricsOverride');
    expect(overrides).toHaveLength(1);
    expect(overrides[0].params).toEqual({ mobile: false, width: 1024, height: 2048, deviceScaleFactor: 1 });
    expect(calls.at(-1)?.method).toBe('Emulation.clearDeviceMetricsOverride');
  });

  it('ignores --height under --full-page so the existing measure-from-content path is preserved', async () => {
    const { chrome, calls } = chromeMockForScreenshot({ width: 1024, height: 2048 });
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./cdp');
    await mod.screenshot(1, { fullPage: true, height: 600 });

    const overrides = calls.filter((c) => c.method === 'Emulation.setDeviceMetricsOverride');
    expect(overrides).toHaveLength(1);
    expect(overrides[0].params).toEqual({ mobile: false, width: 1024, height: 2048, deviceScaleFactor: 1 });
    expect(calls.at(-1)?.method).toBe('Emulation.clearDeviceMetricsOverride');
  });

  it('reflows at the requested width before measuring full-page height', async () => {
    // Simulate that at width=1080 the page reflows to a different content height.
    const { chrome, calls } = chromeMockForScreenshot({ width: 1080, height: 1500 });
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./cdp');
    await mod.screenshot(1, { fullPage: true, width: 1080 });

    const overrides = calls.filter((c) => c.method === 'Emulation.setDeviceMetricsOverride');
    expect(overrides).toHaveLength(2);
    expect(overrides[0].params).toEqual({ mobile: false, width: 1080, height: 0, deviceScaleFactor: 1 });
    expect(overrides[1].params).toEqual({ mobile: false, width: 1080, height: 1500, deviceScaleFactor: 1 });

    const layoutBetween = calls.findIndex((c) => c.method === 'Page.getLayoutMetrics');
    const firstOverride = calls.findIndex((c) => c.method === 'Emulation.setDeviceMetricsOverride');
    expect(layoutBetween).toBeGreaterThan(firstOverride);
    expect(calls.at(-1)?.method).toBe('Emulation.clearDeviceMetricsOverride');
  });

  it('clears the device metrics override even when capture throws', async () => {
    const debuggerApi = {
      attach: vi.fn(async () => {}),
      detach: vi.fn(async () => {}),
      sendCommand: vi.fn(async (_t: unknown, method: string) => {
        if (method === 'Page.captureScreenshot') throw new Error('capture-failed');
        if (method === 'Page.getLayoutMetrics') return { cssContentSize: { width: 800, height: 600 } };
        return {};
      }),
      onDetach: { addListener: vi.fn() },
      onEvent: { addListener: vi.fn() },
    };
    const chrome = {
      tabs: {
        get: vi.fn(async () => ({ id: 1, windowId: 1, url: 'https://example.com' })),
        onRemoved: { addListener: vi.fn() },
        onUpdated: { addListener: vi.fn() },
      },
      debugger: debuggerApi,
      scripting: {},
      runtime: { id: 'opencli-test' },
    };
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./cdp');
    await expect(mod.screenshot(1, { width: 800 })).rejects.toThrow('capture-failed');

    expect(debuggerApi.sendCommand).toHaveBeenCalledWith(
      { tabId: 1 },
      'Emulation.clearDeviceMetricsOverride',
    );
  });
});

function chromeMockForDownloads(initialItems: chrome.downloads.DownloadItem[] = []) {
  const items = new Map(initialItems.map((item) => [item.id, item]));
  const createdListeners: Array<(item: chrome.downloads.DownloadItem) => void> = [];
  const changedListeners: Array<(delta: chrome.downloads.DownloadDelta) => void> = [];
  const downloads = {
    search: vi.fn(async (query: chrome.downloads.DownloadQuery) => {
      if (typeof query.id === 'number') {
        const item = items.get(query.id);
        return item ? [item] : [];
      }
      return [...items.values()];
    }),
    onCreated: {
      addListener: vi.fn((fn: (item: chrome.downloads.DownloadItem) => void) => { createdListeners.push(fn); }),
      removeListener: vi.fn((fn: (item: chrome.downloads.DownloadItem) => void) => {
        const idx = createdListeners.indexOf(fn);
        if (idx >= 0) createdListeners.splice(idx, 1);
      }),
    },
    onChanged: {
      addListener: vi.fn((fn: (delta: chrome.downloads.DownloadDelta) => void) => { changedListeners.push(fn); }),
      removeListener: vi.fn((fn: (delta: chrome.downloads.DownloadDelta) => void) => {
        const idx = changedListeners.indexOf(fn);
        if (idx >= 0) changedListeners.splice(idx, 1);
      }),
    },
  };
  return {
    chrome: { downloads },
    downloads,
    setItem(item: chrome.downloads.DownloadItem) {
      items.set(item.id, item);
    },
    emitCreated(item: chrome.downloads.DownloadItem) {
      items.set(item.id, item);
      for (const listener of [...createdListeners]) listener(item);
    },
    emitChanged(delta: chrome.downloads.DownloadDelta) {
      for (const listener of [...changedListeners]) listener(delta);
    },
  };
}

describe('cdp download waits', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('returns a recent completed download matching filename or URL', async () => {
    const { chrome, downloads } = chromeMockForDownloads([
      {
        id: 7,
        filename: '/tmp/receipt.pdf',
        url: 'https://app.example/download?id=receipt',
        finalUrl: 'https://cdn.example/receipt.pdf',
        mime: 'application/pdf',
        state: 'complete',
        totalBytes: 1234,
        danger: 'safe',
        startTime: new Date().toISOString(),
      } as chrome.downloads.DownloadItem,
    ]);
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./cdp');
    const result = await mod.waitForDownload('receipt', 1000);

    expect(result).toMatchObject({
      downloaded: true,
      id: 7,
      filename: '/tmp/receipt.pdf',
      state: 'complete',
    });
    expect(downloads.onCreated.removeListener).toHaveBeenCalledTimes(1);
    expect(downloads.onChanged.removeListener).toHaveBeenCalledTimes(1);
  });

  it('waits for a matching in-progress download to complete', async () => {
    const mock = chromeMockForDownloads();
    vi.stubGlobal('chrome', mock.chrome);

    const mod = await import('./cdp');
    const promise = mod.waitForDownload('invoice', 1000);
    await Promise.resolve();

    const started = {
      id: 42,
      filename: '/tmp/invoice.crdownload',
      url: 'https://app.example/invoice',
      finalUrl: 'https://app.example/invoice',
      mime: 'application/pdf',
      state: 'in_progress',
      totalBytes: 0,
      danger: 'safe',
      startTime: new Date().toISOString(),
    } as chrome.downloads.DownloadItem;
    mock.emitCreated(started);
    mock.setItem({ ...started, filename: '/tmp/invoice.pdf', state: 'complete', totalBytes: 4567 });
    mock.emitChanged({ id: 42, state: { current: 'complete', previous: 'in_progress' } } as chrome.downloads.DownloadDelta);

    await expect(promise).resolves.toMatchObject({
      downloaded: true,
      id: 42,
      filename: '/tmp/invoice.pdf',
      state: 'complete',
    });
  });
});
