import { describe, it, expect, vi } from 'vitest';
import { BrowserBridge, generateStealthJs } from './browser/index.js';
import { extractTabEntries, diffTabIndexes, appendLimited } from './browser/tabs.js';
import { withTimeoutMs } from './runtime.js';
import { __test__ as cdpTest } from './browser/cdp.js';
import { isRetryableSettleError } from './browser/page.js';
import * as daemonClient from './browser/daemon-client.js';

describe('browser helpers', () => {
  it('extracts tab entries from string snapshots', () => {
    const entries = extractTabEntries('Tab 0 https://example.com\nTab 1 Chrome Extension');

    expect(entries).toEqual([
      { index: 0, identity: 'https://example.com' },
      { index: 1, identity: 'Chrome Extension' },
    ]);
  });

  it('extracts tab entries from MCP markdown format', () => {
    const entries = extractTabEntries(
      '- 0: (current) [Playwright MCP extension](chrome-extension://abc/connect.html)\n- 1: [知乎 - 首页](https://www.zhihu.com/)'
    );

    expect(entries).toEqual([
      { index: 0, identity: '(current) [Playwright MCP extension](chrome-extension://abc/connect.html)' },
      { index: 1, identity: '[知乎 - 首页](https://www.zhihu.com/)' },
    ]);
  });

  it('closes only tabs that were opened during the session', () => {
    const tabsToClose = diffTabIndexes(
      ['https://example.com', 'Chrome Extension'],
      [
        { index: 0, identity: 'https://example.com' },
        { index: 1, identity: 'Chrome Extension' },
        { index: 2, identity: 'https://target.example/page' },
        { index: 3, identity: 'chrome-extension://bridge' },
      ],
    );

    expect(tabsToClose).toEqual([3, 2]);
  });

  it('keeps only the tail of stderr buffers', () => {
    expect(appendLimited('12345', '67890', 8)).toBe('34567890');
  });

  it('times out slow promises', async () => {
    await expect(withTimeoutMs(new Promise(() => {}), 10, 'timeout')).rejects.toThrow('timeout');
  });

  it('retries settle only for target-invalidated errors', () => {
    expect(isRetryableSettleError(new Error('{"code":-32000,"message":"Inspected target navigated or closed"}'))).toBe(true);
    expect(isRetryableSettleError(new Error('attach failed: target no longer exists'))).toBe(false);
    expect(isRetryableSettleError(new Error('malformed exec payload'))).toBe(false);
  });

  it('prefers the real Electron app target over DevTools and blank pages', () => {
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
        type: 'app',
        title: 'Antigravity',
        url: 'http://localhost:3000/',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9224/app',
      },
    ]);

    expect(target?.webSocketDebuggerUrl).toBe('ws://127.0.0.1:9224/app');
  });

  it('honors OPENCLI_CDP_TARGET when multiple inspectable targets exist', () => {
    vi.stubEnv('OPENCLI_CDP_TARGET', 'codex');

    const target = cdpTest.selectCDPTarget([
      {
        type: 'app',
        title: 'Cursor',
        url: 'http://localhost:3000/cursor',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9226/cursor',
      },
      {
        type: 'app',
        title: 'OpenAI Codex',
        url: 'http://localhost:3000/codex',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9226/codex',
      },
    ]);

    expect(target?.webSocketDebuggerUrl).toBe('ws://127.0.0.1:9226/codex');
  });
});

describe('BrowserBridge state', () => {
  it('transitions to closed after close()', async () => {
    const mcp = new BrowserBridge();

    expect(mcp.state).toBe('idle');

    await mcp.close();

    expect(mcp.state).toBe('closed');
  });

  it('rejects connect() after the session has been closed', async () => {
    const mcp = new BrowserBridge();
    await mcp.close();

    await expect(mcp.connect()).rejects.toThrow('Session is closed');
  });

  it('rejects connect() while already connecting', async () => {
    const mcp = new BrowserBridge();
    (mcp as any)._state = 'connecting';

    await expect(mcp.connect()).rejects.toThrow('Already connecting');
  });

  it('rejects connect() while closing', async () => {
    const mcp = new BrowserBridge();
    (mcp as any)._state = 'closing';

    await expect(mcp.connect()).rejects.toThrow('Session is closing');
  });

  it('fails fast when daemon is running but extension is disconnected', async () => {
    vi.spyOn(daemonClient, 'isExtensionConnected').mockResolvedValue(false);
    vi.spyOn(daemonClient, 'isDaemonRunning').mockResolvedValue(true);

    const mcp = new BrowserBridge();

    await expect(mcp.connect({ timeout: 0.1 })).rejects.toThrow('Browser Extension is not connected');
  });
});

describe('stealth anti-detection', () => {
  it('generates non-empty JS string', () => {
    const js = generateStealthJs();
    expect(typeof js).toBe('string');
    expect(js.length).toBeGreaterThan(100);
  });

  it('contains all 7 anti-detection patches', () => {
    const js = generateStealthJs();
    // 1. webdriver
    expect(js).toContain('navigator');
    expect(js).toContain('webdriver');
    // 2. chrome stub
    expect(js).toContain('window.chrome');
    // 3. plugins
    expect(js).toContain('plugins');
    expect(js).toContain('PDF Viewer');
    // 4. languages
    expect(js).toContain('languages');
    // 5. permissions
    expect(js).toContain('Permissions');
    expect(js).toContain('notifications');
    // 6. automation artifacts (dynamic cdc_ scan)
    expect(js).toContain('__playwright');
    expect(js).toContain('__puppeteer');
    expect(js).toContain('getOwnPropertyNames');
    expect(js).toContain('cdc_');
    // 7. CDP stack trace cleanup
    expect(js).toContain('Error.prototype');
    expect(js).toContain('puppeteer_evaluation_script');
    expect(js).toContain('getOwnPropertyDescriptor');
  });

  it('includes guard flag to prevent double-injection', () => {
    const js = generateStealthJs();
    // Guard uses a non-enumerable property on a built-in prototype
    expect(js).toContain("EventTarget.prototype");
    // Guard should check early and return 'skipped'
    expect(js).toContain("return 'skipped'");
    // Normal path returns 'applied'
    expect(js).toContain("return 'applied'");
  });

  it('generates syntactically valid JS', () => {
    const js = generateStealthJs();
    // Should not throw when parsed
    expect(() => new Function(js)).not.toThrow();
  });
});
