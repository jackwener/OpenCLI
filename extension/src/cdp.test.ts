import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createChromeMock() {
  const tabs = {
    get: vi.fn(async (_tabId: number) => ({
      id: 1,
      windowId: 1,
      url: 'https://x.com/home',
    })),
    onRemoved: { addListener: vi.fn() },
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
    onEvent: { addListener: vi.fn() },
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

  // Dead test: chrome.scripting.executeScript was removed from cdp.ts;
  // this test references functionality that no longer exists. Delete or rewrite
  // when cdp attach-recovery logic is next updated.
  it.skip('retries after cleanup when attach fails with a foreign extension error', async () => {
    const { chrome, debuggerApi, scripting } = createChromeMock();
    debuggerApi.attach
      .mockRejectedValueOnce(new Error('Cannot access a chrome-extension:// URL of different extension'))
      .mockResolvedValueOnce(undefined);
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./cdp');
    const result = await mod.evaluate(1, '1');

    expect(result).toBe('ok');
    expect(scripting.executeScript).toHaveBeenCalledTimes(1);
    expect(debuggerApi.attach).toHaveBeenCalledTimes(2);
  });

  it('preserves capture intent across self-detach and rearms after reattach', async () => {
    const { chrome, debuggerApi } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./cdp');

    await mod.startNetworkCapture(1, '/api/');
    debuggerApi.sendCommand.mockClear();
    await mod.detach(1);
    await mod.ensureAttached(1);

    expect(debuggerApi.sendCommand).toHaveBeenCalledWith({ tabId: 1 }, 'Network.enable');
    expect(debuggerApi.sendCommand).toHaveBeenCalledWith({ tabId: 1 }, 'Runtime.enable');
  });

  it('marks capture unarmed before detach so failed detach cannot block rearm', async () => {
    const { chrome, debuggerApi } = createChromeMock();
    debuggerApi.detach.mockRejectedValueOnce(new Error('detach failed'));
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./cdp');

    await mod.startNetworkCapture(1, '/api/');
    debuggerApi.sendCommand.mockClear();
    await mod.detach(1);
    await mod.ensureAttached(1);

    expect(debuggerApi.attach).toHaveBeenCalled();
    expect(debuggerApi.sendCommand).toHaveBeenCalledWith({ tabId: 1 }, 'Network.enable');
    expect(debuggerApi.sendCommand).toHaveBeenCalledWith({ tabId: 1 }, 'Runtime.enable');
  });

  it('preserves buffered capture data across detach when capture intent remains', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./cdp');
    mod.registerListeners();

    const onEvent = chrome.debugger.onEvent.addListener.mock.calls[0][0] as (source: { tabId?: number }, method: string, params: unknown) => Promise<void>;
    const onDetach = chrome.debugger.onDetach.addListener.mock.calls[0][0] as (source: { tabId?: number }) => void;

    await mod.startNetworkCapture(1, '/api/');
    await onEvent({ tabId: 1 }, 'Network.requestWillBeSent', {
      requestId: '1',
      request: { url: 'https://x.test/api/items', method: 'GET', headers: {} },
      timestamp: 1,
    });
    await onEvent({ tabId: 1 }, 'Runtime.consoleAPICalled', {
      type: 'error',
      args: [{ value: 'boom' }],
      timestamp: 2,
    });

    onDetach({ tabId: 1 });

    expect(await mod.readNetworkCapture(1)).toEqual([
      expect.objectContaining({ url: 'https://x.test/api/items', method: 'GET' }),
    ]);
    expect(await mod.readConsoleCapture(1)).toEqual([
      expect.objectContaining({ level: 'error', text: 'boom' }),
    ]);
  });

  it('does not clear console history when restarting network capture', async () => {
    const { chrome } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./cdp');
    mod.registerListeners();

    const onEvent = chrome.debugger.onEvent.addListener.mock.calls[0][0] as (source: { tabId?: number }, method: string, params: unknown) => Promise<void>;

    await mod.startNetworkCapture(1, '/api/');
    await onEvent({ tabId: 1 }, 'Runtime.consoleAPICalled', {
      type: 'error',
      args: [{ value: 'boom' }],
      timestamp: 2,
    });

    await mod.startNetworkCapture(1, '/other/');

    expect(await mod.readConsoleCapture(1)).toEqual([
      expect.objectContaining({ level: 'error', text: 'boom' }),
    ]);
  });

  it('rearms capture on read when intent exists but the state is unarmed', async () => {
    const { chrome, debuggerApi } = createChromeMock();
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./cdp');

    await mod.startNetworkCapture(1, '/api/');
    debuggerApi.sendCommand.mockClear();
    await mod.detach(1);
    await mod.readNetworkCapture(1);

    expect(debuggerApi.attach).toHaveBeenCalled();
    expect(debuggerApi.sendCommand).toHaveBeenCalledWith({ tabId: 1 }, 'Network.enable');
    expect(debuggerApi.sendCommand).toHaveBeenCalledWith({ tabId: 1 }, 'Runtime.enable');
  });

  it('waits for in-flight response body fetches before draining network capture', async () => {
    const { chrome, debuggerApi } = createChromeMock();
    let resolveBody: ((value: unknown) => void) | undefined;
    debuggerApi.sendCommand.mockImplementation(async (_target: unknown, method: string) => {
      if (method === 'Runtime.evaluate') return { result: { value: 'ok' } };
      if (method === 'Network.getResponseBody') {
        return await new Promise((resolve) => {
          resolveBody = resolve;
        });
      }
      return {};
    });
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./cdp');
    mod.registerListeners();

    const onEvent = chrome.debugger.onEvent.addListener.mock.calls[0][0] as (source: { tabId?: number }, method: string, params: unknown) => Promise<void>;

    await mod.startNetworkCapture(1, '/api/');
    await onEvent({ tabId: 1 }, 'Network.requestWillBeSent', {
      requestId: '1',
      request: { url: 'https://x.test/api/items', method: 'GET', headers: {} },
      timestamp: 1,
    });
    await onEvent({ tabId: 1 }, 'Network.responseReceived', {
      requestId: '1',
      response: { status: 200, mimeType: 'application/json', headers: {} },
    });
    await onEvent({ tabId: 1 }, 'Network.loadingFinished', { requestId: '1' });

    let settled = false;
    const readPromise = mod.readNetworkCapture(1).then((entries) => {
      settled = true;
      return entries;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    resolveBody?.({ body: '{"ok":true}', base64Encoded: false });

    await expect(readPromise).resolves.toEqual([
      expect.objectContaining({
        url: 'https://x.test/api/items',
        responseStatus: 200,
        responsePreview: '{"ok":true}',
      }),
    ]);
  });

  it('surfaces rearm failures on read instead of silently returning stale data', async () => {
    const { chrome, debuggerApi } = createChromeMock();
    debuggerApi.attach.mockResolvedValueOnce(undefined).mockRejectedValue(new Error('attach failed'));
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./cdp');

    await mod.startNetworkCapture(1, '/api/');
    await mod.detach(1);

    await expect(mod.readNetworkCapture(1)).rejects.toThrow('attach failed');
  });
});
