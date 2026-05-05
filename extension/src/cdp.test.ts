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

    expect(debuggerEventListeners).toHaveLength(1);
    debuggerEventListeners[0](
      { tabId: 1 },
      'Runtime.executionContextCreated',
      { context: { id: 11, auxData: { frameId: 'frame-1', isDefault: false } } },
    );
    debuggerEventListeners[0](
      { tabId: 1 },
      'Runtime.executionContextCreated',
      { context: { id: 22, auxData: { frameId: 'frame-1', isDefault: true } } },
    );

    await mod.evaluateInFrame(1, 'document.title', 'frame-1');

    expect(debuggerApi.sendCommand).toHaveBeenCalledWith(
      { tabId: 1 },
      'Runtime.evaluate',
      expect.objectContaining({ contextId: 22 }),
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
