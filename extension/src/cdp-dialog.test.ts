import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (source: { tabId?: number }, method: string, params: any) => void;

function createChromeMock() {
  const events: Listener[] = [];
  const debuggerApi = {
    attach: vi.fn(async () => {}),
    detach: vi.fn(async () => {}),
    sendCommand: vi.fn(async (_target: unknown, method: string) => {
      if (method === 'Runtime.evaluate') return { result: { value: 'ok' } };
      return {};
    }),
    onDetach: { addListener: vi.fn() },
    onEvent: { addListener: vi.fn((fn: Listener) => { events.push(fn); }) },
  };
  const chrome = {
    tabs: {
      get: vi.fn(async () => ({ id: 1, windowId: 1, url: 'https://www.facebook.com/' })),
      onRemoved: { addListener: vi.fn() },
      onUpdated: { addListener: vi.fn() },
    },
    debugger: debuggerApi,
    runtime: { id: 'opencli-test' },
  };
  const fire = (method: string, params: any) => { for (const fn of events) fn({ tabId: 1 }, method, params); };
  return { chrome, debuggerApi, fire };
}

describe('cdp native dialog detection', () => {
  beforeEach(() => { vi.resetModules(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('enables Page events on attach', async () => {
    const mock = createChromeMock();
    vi.stubGlobal('chrome', mock.chrome);
    const mod = await import('./cdp');
    await mod.ensureAttached(1);
    expect(mock.debuggerApi.sendCommand).toHaveBeenCalledWith({ tabId: 1 }, 'Page.enable');
  });

  it('fails page commands fast while a dialog is open, and recovers when it closes', async () => {
    const mock = createChromeMock();
    vi.stubGlobal('chrome', mock.chrome);
    const mod = await import('./cdp');
    mod.registerListeners();
    await mod.ensureAttached(1);

    mock.fire('Page.javascriptDialogOpening', { type: 'beforeunload', message: '', url: 'https://www.facebook.com/' });
    mock.debuggerApi.sendCommand.mockClear();

    await expect(mod.evaluate(1, 'document.title')).rejects.toThrow(/JavaScript dialog is open \(beforeunload: "Leave site\?"\)/);
    await expect(mod.insertText(1, 'hi')).rejects.toThrow(/JavaScript dialog is open/);
    // Neither the health probe nor the command reached the blocked page.
    expect(mock.debuggerApi.sendCommand).not.toHaveBeenCalledWith({ tabId: 1 }, 'Runtime.evaluate', expect.anything(), expect.anything());

    mock.fire('Page.javascriptDialogClosed', { result: false });
    await expect(mod.evaluate(1, 'document.title')).resolves.toBe('ok');
  });

  it('accepts the beforeunload prompt raised while abandoning an owned page', async () => {
    const mock = createChromeMock();
    vi.stubGlobal('chrome', mock.chrome);
    const mod = await import('./cdp');
    mod.registerListeners();
    await mod.ensureAttached(1);

    let settled = false;
    await mod.abandonPage(1, async () => {
      // Chrome raises the prompt after the navigation call has returned.
      setTimeout(() => {
        mock.fire('Page.javascriptDialogOpening', { type: 'beforeunload', message: '', url: 'https://www.facebook.com/' });
        settled = true;
      }, 20);
    }, async () => settled);

    expect(mock.debuggerApi.sendCommand).toHaveBeenCalledWith(
      { tabId: 1 }, 'Page.handleJavaScriptDialog', { accept: true },
    );
  });

  it('re-attaches a detached tab before abandoning it, so its prompt is still answered', async () => {
    const mock = createChromeMock();
    vi.stubGlobal('chrome', mock.chrome);
    const mod = await import('./cdp');
    mod.registerListeners();
    // No ensureAttached here: navigate had detached the debugger before release.

    let settled = false;
    await mod.abandonPage(1, async () => {
      setTimeout(() => {
        mock.fire('Page.javascriptDialogOpening', { type: 'beforeunload', message: '', url: 'https://www.facebook.com/' });
        settled = true;
      }, 20);
    }, async () => settled);

    expect(mock.debuggerApi.attach).toHaveBeenCalled();
    expect(mock.debuggerApi.sendCommand).toHaveBeenCalledWith({ tabId: 1 }, 'Page.enable');
    expect(mock.debuggerApi.sendCommand).toHaveBeenCalledWith(
      { tabId: 1 }, 'Page.handleJavaScriptDialog', { accept: true },
    );
  });

  it('never accepts a beforeunload prompt outside a release', async () => {
    const mock = createChromeMock();
    vi.stubGlobal('chrome', mock.chrome);
    const mod = await import('./cdp');
    mod.registerListeners();
    await mod.ensureAttached(1);

    mock.fire('Page.javascriptDialogOpening', { type: 'beforeunload', message: '', url: 'https://www.facebook.com/' });

    expect(mock.debuggerApi.sendCommand).not.toHaveBeenCalledWith(
      { tabId: 1 }, 'Page.handleJavaScriptDialog', expect.anything(),
    );
    expect(mod.getOpenDialog(1)?.type).toBe('beforeunload');
  });
});
