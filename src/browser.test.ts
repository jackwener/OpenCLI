import { afterEach, describe, it, expect, vi } from 'vitest';
import { BrowserBridge } from './browser/index.js';
import { withTimeoutMs } from './runtime.js';
import { __test__ as cdpTest } from './browser/cdp.js';
import { classifyBrowserError } from './browser/errors.js';
import * as daemonTransport from './browser/daemon-transport.js';
import * as daemonLifecycle from './browser/daemon-lifecycle.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('browser helpers', () => {
  it('times out slow promises', async () => {
    await expect(withTimeoutMs(new Promise(() => {}), 10, 'timeout')).rejects.toThrow('timeout');
  });

  it('classifies browser errors with correct kind and retry advice', () => {
    // CDP target navigation — page-level settle retry
    const nav = classifyBrowserError(new Error('{"code":-32000,"message":"Inspected target navigated or closed"}'));
    expect(nav.kind).toBe('target-navigation');
    expect(nav.delayMs).toBe(200);

    // Extension transient — daemon-client retry only, NOT page-level
    const ext = classifyBrowserError(new Error('Extension disconnected'));
    expect(ext.kind).toBe('extension-transient');
    expect(ext.delayMs).toBe(1500);

    // Non-transient errors — not retryable
    expect(classifyBrowserError(new Error('malformed exec payload')).kind).toBe('non-retryable');
    expect(classifyBrowserError(new Error('Permission denied')).kind).toBe('non-retryable');
  });

  it('prefers the browser page target over DevTools and blank pages', () => {
    const target = cdpTest.selectCDPTarget([
      {
        type: 'page',
        title: 'DevTools - localhost:9224',
        url: 'devtools://devtools/bundled/inspector.html',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9224/devtools',
      },
      {
        type: 'page',
        title: '',
        url: 'about:blank',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9224/blank',
      },
      {
        type: 'page',
        title: 'Example',
        url: 'http://localhost:3000/',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9224/app',
      },
    ]);

    expect(target?.webSocketDebuggerUrl).toBe('ws://127.0.0.1:9224/app');
  });

  it('honors OPENCLI_CDP_TARGET when multiple inspectable targets exist', () => {
    vi.stubEnv('OPENCLI_CDP_TARGET', 'docs');

    const target = cdpTest.selectCDPTarget([
      {
        type: 'page',
        title: 'Example',
        url: 'http://localhost:3000/example',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9226/example',
      },
      {
        type: 'page',
        title: 'Documentation',
        url: 'http://localhost:3000/docs',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9226/docs',
      },
    ]);

    expect(target?.webSocketDebuggerUrl).toBe('ws://127.0.0.1:9226/docs');
  });

  it('leaves http tabs in document order when one carries a query string', () => {
    const target = cdpTest.selectCDPTarget([
      {
        type: 'page',
        title: 'Example',
        url: 'https://example.com/app?q=1',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/query',
      },
      {
        type: 'page',
        title: 'Example',
        url: 'https://example.com/app',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/plain',
      },
    ]);

    expect(target?.webSocketDebuggerUrl).toBe('ws://127.0.0.1:9222/query');
  });

});

describe('BrowserBridge state', () => {
  it('transitions to closed after close()', async () => {
    const bridge = new BrowserBridge();

    expect(bridge.state).toBe('idle');

    await bridge.close();

    expect(bridge.state).toBe('closed');
  });

  it('rejects connect() after the session has been closed', async () => {
    const bridge = new BrowserBridge();
    await bridge.close();

    await expect(bridge.connect()).rejects.toThrow('Session is closed');
  });

  it('rejects connect() while already connecting', async () => {
    const bridge = new BrowserBridge();
    (bridge as unknown as { _state: string })._state = 'connecting';

    await expect(bridge.connect()).rejects.toThrow('Already connecting');
  });

  it('rejects connect() while closing', async () => {
    const bridge = new BrowserBridge();
    (bridge as unknown as { _state: string })._state = 'closing';

    await expect(bridge.connect()).rejects.toThrow('Session is closing');
  });

  it('fails fast when daemon is running but extension is disconnected (same version)', async () => {
    const { PKG_VERSION } = await import('./version.js');
    vi.spyOn(daemonTransport, 'getDaemonHealth').mockResolvedValue({
      state: 'no-extension',
      status: {
        ok: true,
        pid: 999999,
        uptime: 0,
        daemonVersion: PKG_VERSION,
        extensionConnected: false,
        pending: 0,
        memoryMB: 0,
        port: 0,
      },
    });

    const bridge = new BrowserBridge();

    await expect(bridge.connect({ timeout: 0.1 })).rejects.toThrow('Browser Bridge extension not connected');
  });

  it('threads preferredContextId into every readiness health read', async () => {
    const { PKG_VERSION } = await import('./version.js');
    const spy = vi.spyOn(daemonTransport, 'getDaemonHealth').mockResolvedValue({
      state: 'no-extension',
      status: {
        ok: true,
        pid: 999999,
        uptime: 0,
        daemonVersion: PKG_VERSION,
        extensionConnected: false,
        pending: 0,
        memoryMB: 0,
        port: 0,
      },
    });

    const bridge = new BrowserBridge();

    await expect(bridge.connect({ timeout: 0.1, preferredContextId: 'zvypsyje' })).rejects.toThrow('Browser Bridge extension not connected');
    expect(spy.mock.calls.length).toBeGreaterThan(1);
    for (const call of spy.mock.calls) {
      expect(call[0]).toMatchObject({ preferredContextId: 'zvypsyje' });
    }
  });

  it('attempts stale daemon replacement when daemonVersion is missing', async () => {
    vi.spyOn(daemonTransport, 'getDaemonHealth').mockResolvedValue({
      state: 'no-extension',
      status: {
        ok: true,
        pid: 999999,
        uptime: 0,
        extensionConnected: false,
        pending: 0,
        memoryMB: 0,
        port: 0,
      },
    });
    vi.spyOn(daemonLifecycle.daemonLifecycleHooks, 'requestDaemonShutdown').mockResolvedValue(false);
    // Keep the SIGKILL fallback's poll short — neither pid 999999 nor the test
    // daemon exists, so we'd otherwise spin for 2s on every test in the block.
    vi.spyOn(daemonLifecycle.daemonLifecycleHooks, 'waitForDaemonStop').mockResolvedValue(false);

    const bridge = new BrowserBridge();

    await expect(bridge.connect({ timeout: 0.1 })).rejects.toThrow('Stale daemon could not be replaced');
  });

  it('attempts stale daemon replacement when daemonVersion mismatches', async () => {
    vi.spyOn(daemonTransport, 'getDaemonHealth').mockResolvedValue({
      state: 'no-extension',
      status: {
        ok: true,
        pid: 999999,
        uptime: 0,
        daemonVersion: '0.0.1',
        extensionConnected: false,
        pending: 0,
        memoryMB: 0,
        port: 0,
      },
    });
    vi.spyOn(daemonLifecycle.daemonLifecycleHooks, 'requestDaemonShutdown').mockResolvedValue(false);
    vi.spyOn(daemonLifecycle.daemonLifecycleHooks, 'waitForDaemonStop').mockResolvedValue(false);

    const bridge = new BrowserBridge();

    await expect(bridge.connect({ timeout: 0.1 })).rejects.toThrow('Stale daemon could not be replaced');
  });

  it('attempts stale daemon replacement even when extension is connected', async () => {
    vi.spyOn(daemonTransport, 'getDaemonHealth').mockResolvedValue({
      state: 'ready',
      status: {
        ok: true,
        pid: 999999,
        uptime: 0,
        daemonVersion: '0.0.1',
        extensionConnected: true,
        pending: 0,
        memoryMB: 0,
        port: 0,
      },
    });
    vi.spyOn(daemonLifecycle.daemonLifecycleHooks, 'requestDaemonShutdown').mockResolvedValue(false);
    vi.spyOn(daemonLifecycle.daemonLifecycleHooks, 'waitForDaemonStop').mockResolvedValue(false);

    const bridge = new BrowserBridge();

    await expect(bridge.connect({ timeout: 0.1 })).rejects.toThrow('Stale daemon could not be replaced');
  });

  it('falls back to SIGKILL when stale daemon refuses graceful shutdown', async () => {
    vi.spyOn(daemonTransport, 'getDaemonHealth').mockResolvedValue({
      state: 'no-extension',
      status: {
        ok: true,
        pid: 99999,
        uptime: 0,
        daemonVersion: '0.0.1',
        extensionConnected: false,
        pending: 0,
        memoryMB: 0,
        port: 0,
      },
    });
    vi.spyOn(daemonLifecycle.daemonLifecycleHooks, 'requestDaemonShutdown').mockResolvedValue(false);
    // Graceful shutdown short-circuits to false (requestDaemonShutdown -> false).
    // After SIGKILL the port is released, so the second waitForDaemonStop returns true.
    vi.spyOn(daemonLifecycle.daemonLifecycleHooks, 'waitForDaemonStop').mockResolvedValue(true);
    vi.spyOn(daemonLifecycle.daemonLifecycleHooks, 'spawnDaemonProcess').mockReturnValue(null as unknown as ReturnType<typeof daemonLifecycle.spawnDaemonProcess>);
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const bridge = new BrowserBridge();

    // We expect the stale-daemon path to succeed and then continue into the
    // no-extension wait (which times out with `timeout: 0.1`), producing the
    // extension-not-connected error rather than the stale-daemon error.
    await expect(bridge.connect({ timeout: 0.1 })).rejects.toThrow('Browser Bridge extension not connected');
    expect(killSpy).toHaveBeenCalledWith(99999, 'SIGKILL');
  });

  it('reports stale daemon error when SIGKILL fails to release the port', async () => {
    vi.spyOn(daemonTransport, 'getDaemonHealth').mockResolvedValue({
      state: 'no-extension',
      status: {
        ok: true,
        pid: 99999,
        uptime: 0,
        daemonVersion: '0.0.1',
        extensionConnected: false,
        pending: 0,
        memoryMB: 0,
        port: 0,
      },
    });
    vi.spyOn(daemonLifecycle.daemonLifecycleHooks, 'requestDaemonShutdown').mockResolvedValue(false);
    // Graceful + SIGKILL both fail to release the port.
    vi.spyOn(daemonLifecycle.daemonLifecycleHooks, 'waitForDaemonStop').mockResolvedValue(false);
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
    });

    const bridge = new BrowserBridge();

    await expect(bridge.connect({ timeout: 0.1 })).rejects.toThrow('Stale daemon could not be replaced');
  });
});
