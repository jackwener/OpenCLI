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
    tabs,
    debuggerApi,
    scripting,
  };
}

describe('cdp attach recovery policy', () => {
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
    const result = await mod.evaluate(1, '1', { allowDomCleanup: true });

    expect(result).toBe('ok');
    expect(debuggerApi.attach).toHaveBeenCalledTimes(1);
    expect(scripting.executeScript).not.toHaveBeenCalled();
  });

  it('does not clean up borrowed tabs when attach fails with a foreign extension error', async () => {
    const { chrome, debuggerApi, scripting } = createChromeMock();
    debuggerApi.attach.mockRejectedValueOnce(new Error('Cannot access a chrome-extension:// URL of different extension'));
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./cdp');

    await expect(mod.evaluate(1, '1', { allowDomCleanup: false })).rejects.toThrow(
      'attach failed: Cannot access a chrome-extension:// URL of different extension',
    );
    expect(debuggerApi.attach).toHaveBeenCalledTimes(1);
    expect(scripting.executeScript).not.toHaveBeenCalled();
  });

  it('retries after cleanup for owned tabs when attach fails with a foreign extension error', async () => {
    const { chrome, debuggerApi, scripting } = createChromeMock();
    debuggerApi.attach
      .mockRejectedValueOnce(new Error('Cannot access a chrome-extension:// URL of different extension'))
      .mockResolvedValueOnce(undefined);
    vi.stubGlobal('chrome', chrome);

    const mod = await import('./cdp');
    const result = await mod.evaluate(1, '1', { allowDomCleanup: true });

    expect(result).toBe('ok');
    expect(scripting.executeScript).toHaveBeenCalledTimes(1);
    expect(debuggerApi.attach).toHaveBeenCalledTimes(2);
  });
});
