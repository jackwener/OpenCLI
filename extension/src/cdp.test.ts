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

describe('cdp network capture survives forced re-attach', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createReattachMock() {
    const onDetachListeners: Array<(source: { tabId?: number }) => void> = [];
    let failNextHealthCheck = false;
    let networkEnableCount = 0;
    const debuggerApi = {
      attach: vi.fn(async () => {}),
      detach: vi.fn(async ({ tabId }: { tabId?: number }) => {
        // Chrome fires onDetach whenever the debugger detaches from a tab.
        for (const fn of onDetachListeners) fn({ tabId });
      }),
      sendCommand: vi.fn(async (_target: unknown, method: string, params?: any) => {
        if (method === 'Runtime.evaluate' && params?.expression === '1') {
          if (failNextHealthCheck) {
            failNextHealthCheck = false;
            throw new Error('Inspected target navigated or closed');
          }
          return { result: { value: '1' } };
        }
        if (method === 'Network.enable') {
          networkEnableCount += 1;
          return {};
        }
        return {};
      }),
      onDetach: { addListener: vi.fn((fn: (s: { tabId?: number }) => void) => { onDetachListeners.push(fn); }) },
      onEvent: { addListener: vi.fn() },
    };
    const tabs = {
      get: vi.fn(async () => ({ id: 1, windowId: 1, url: 'https://x.com/home' })),
      onRemoved: { addListener: vi.fn() },
      onUpdated: { addListener: vi.fn() },
    };
    return {
      chrome: { tabs, debugger: debuggerApi, scripting: {}, runtime: { id: 'opencli-test' } },
      debuggerApi,
      failNextHealthCheck: () => { failNextHealthCheck = true; },
      networkEnableCount: () => networkEnableCount,
    };
  }

  it('preserves armed network capture and re-enables Network across a forced re-attach', async () => {
    const mock = createReattachMock();
    vi.stubGlobal('chrome', mock.chrome);

    const mod = await import('./cdp');
    // Wire the onDetach handler that wipes networkCaptures on detach.
    mod.registerListeners();

    await mod.startNetworkCapture(1);
    expect(mod.hasActiveNetworkCapture(1)).toBe(true);
    const enablesAfterStart = mock.networkEnableCount();

    // The next ensureAttached health-check throws, forcing a detach + re-attach.
    // The detach fires onDetach (which deletes the capture) and disables the
    // Network domain — the capture must be restored, not silently dropped.
    mock.failNextHealthCheck();
    await mod.ensureAttached(1);

    expect(mod.hasActiveNetworkCapture(1)).toBe(true);
    expect(mock.networkEnableCount()).toBeGreaterThan(enablesAfterStart);
  });
});

describe('cdp network capture correctness', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createNetworkMock() {
    const onEventListeners = [];
    const debuggerApi = {
      attach: vi.fn(async () => {}),
      detach: vi.fn(async () => {}),
      sendCommand: vi.fn(async (_target, method, params) => {
        if (method === 'Runtime.evaluate' && params?.expression === '1') return { result: { value: '1' } };
        if (method === 'Network.getRequestPostData') return {}; // no override; use inline postData
        return {};
      }),
      onDetach: { addListener: vi.fn() },
      onEvent: { addListener: vi.fn((fn) => { onEventListeners.push(fn); }) },
    };
    const tabs = {
      get: vi.fn(async () => ({ id: 1, windowId: 1, url: 'https://x.com/home' })),
      onRemoved: { addListener: vi.fn() },
      onUpdated: { addListener: vi.fn() },
    };
    const fire = async (method, params) => {
      for (const fn of onEventListeners) await fn({ tabId: 1 }, method, params);
    };
    return {
      chrome: { tabs, debugger: debuggerApi, scripting: {}, runtime: { id: 'opencli-test' } },
      fire,
    };
  }

  it('preserves the original POST body when a captured request follows a redirect', async () => {
    const mock = createNetworkMock();
    vi.stubGlobal('chrome', mock.chrome);
    const mod = await import('./cdp');
    mod.registerListeners();
    await mod.startNetworkCapture(1, 'api.example');

    // Initial POST with a body.
    await mock.fire('Network.requestWillBeSent', {
      requestId: 'r1',
      request: { url: 'https://api.example/login', method: 'POST', postData: 'user=a&pass=b', hasPostData: true },
    });
    // The 302 target re-fires with the SAME requestId, carried via redirectResponse,
    // as a GET with no postData — this must NOT wipe the captured body.
    await mock.fire('Network.requestWillBeSent', {
      requestId: 'r1',
      redirectResponse: { status: 302, url: 'https://api.example/login' },
      request: { url: 'https://api.example/home', method: 'GET' },
    });

    const entries = await mod.readNetworkCapture(1);
    expect(entries).toHaveLength(1);
    expect(entries[0].requestBodyPreview).toBe('user=a&pass=b');
    expect(entries[0].requestBodyKind).toBe('string');
  });

  it('does not create an orphan entry from a response after the request was drained', async () => {
    const mock = createNetworkMock();
    vi.stubGlobal('chrome', mock.chrome);
    const mod = await import('./cdp');
    mod.registerListeners();
    await mod.startNetworkCapture(1, 'api.example');

    await mock.fire('Network.requestWillBeSent', {
      requestId: 'r2',
      request: { url: 'https://api.example/x', method: 'GET' },
    });
    // Read drains entries + clears requestToIndex while the request is in flight.
    const first = await mod.readNetworkCapture(1);
    expect(first).toHaveLength(1);

    // Late response for the drained request must not resurrect a half-entry.
    await mock.fire('Network.responseReceived', {
      requestId: 'r2',
      response: { url: 'https://api.example/x', status: 200, mimeType: 'text/html' },
    });
    const second = await mod.readNetworkCapture(1);
    expect(second).toEqual([]);
  });
});

describe('cdp evaluateInFrame stale context fallback', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to the frame target when the cached context id went stale', async () => {
    const debuggerEventListeners = [];
    const debuggerApi = {
      attach: vi.fn(async () => {}),
      detach: vi.fn(async () => {}),
      sendCommand: vi.fn(async (target, method, params) => {
        if (method === 'Runtime.enable') return {};
        // The cached context id is stale after the frame navigated: CDP rejects.
        if (method === 'Runtime.evaluate' && params?.contextId === 99) {
          throw new Error('Cannot find context with specified id');
        }
        if (method === 'Target.setDiscoverTargets') return {};
        if (method === 'Target.setAutoAttach') return {};
        if (method === 'Target.getTargets') {
          return { targetInfos: [{ targetId: 'stale-frame', type: 'iframe', url: 'https://frame.test' }] };
        }
        if (target?.targetId === 'stale-frame' && method === 'Runtime.evaluate') {
          return { result: { value: 'frame-ok' } };
        }
        return {};
      }),
      onDetach: { addListener: vi.fn() },
      onEvent: { addListener: vi.fn((fn) => { debuggerEventListeners.push(fn); }) },
    };
    const tabs = {
      get: vi.fn(async () => ({ id: 1, windowId: 1, url: 'https://x.com/home' })),
      onRemoved: { addListener: vi.fn() },
      onUpdated: { addListener: vi.fn() },
    };
    vi.stubGlobal('chrome', { tabs, debugger: debuggerApi, scripting: {}, runtime: { id: 'opencli-test' } });

    const mod = await import('./cdp');
    mod.registerFrameTracking();
    // Cache a context id (99) for the frame, which then goes stale.
    for (const fn of debuggerEventListeners) {
      fn({ tabId: 1 }, 'Runtime.executionContextCreated', {
        context: { id: 99, auxData: { frameId: 'stale-frame', isDefault: true } },
      });
    }

    const result = await mod.evaluateInFrame(1, 'document.title', 'stale-frame');

    expect(result).toBe('frame-ok');
    expect(debuggerApi.attach).toHaveBeenCalledWith({ targetId: 'stale-frame' }, '1.3');
  });
});

describe('cdp command deadline', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function createHangingChromeMock() {
    const { chrome, debuggerApi } = createChromeMock();
    // A page-blocking native dialog (alert/confirm) makes Runtime.evaluate
    // never resolve; every other command still works.
    debuggerApi.sendCommand = vi.fn((_target: unknown, method: string) => {
      if (method === 'Runtime.evaluate') return new Promise<never>(() => {});
      return Promise.resolve({});
    }) as typeof debuggerApi.sendCommand;
    return { chrome, debuggerApi };
  }

  it('evaluate rejects instead of hanging forever when Runtime.evaluate never resolves', async () => {
    vi.useFakeTimers();
    const { chrome } = createHangingChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./cdp');
    const pending = mod.evaluate(1, 'alert("blocked")');
    const assertion = expect(pending).rejects.toThrow(/timed out after 60s/);
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
  });

  it('evaluate honors a caller-supplied deadline from the command timeout', async () => {
    vi.useFakeTimers();
    const { chrome } = createHangingChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./cdp');
    const pending = mod.evaluate(1, 'alert("blocked")', false, 10_000);
    const assertion = expect(pending).rejects.toThrow(/timed out after 10s/);
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });
});
