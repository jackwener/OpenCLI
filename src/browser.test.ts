import { afterEach, describe, it, expect, vi } from 'vitest';
import { BrowserBridge, __test__ } from './browser/index.js';
import * as daemonClient from './browser/daemon-client.js';

describe('browser helpers', () => {
  it('extracts tab entries from string snapshots', () => {
    const entries = __test__.extractTabEntries('Tab 0 https://example.com\nTab 1 Chrome Extension');

    expect(entries).toEqual([
      { index: 0, identity: 'https://example.com' },
      { index: 1, identity: 'Chrome Extension' },
    ]);
  });

  it('extracts tab entries from MCP markdown format', () => {
    const entries = __test__.extractTabEntries(
      '- 0: (current) [Playwright MCP extension](chrome-extension://abc/connect.html)\n- 1: [知乎 - 首页](https://www.zhihu.com/)'
    );

    expect(entries).toEqual([
      { index: 0, identity: '(current) [Playwright MCP extension](chrome-extension://abc/connect.html)' },
      { index: 1, identity: '[知乎 - 首页](https://www.zhihu.com/)' },
    ]);
  });

  it('closes only tabs that were opened during the session', () => {
    const tabsToClose = __test__.diffTabIndexes(
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
    expect(__test__.appendLimited('12345', '67890', 8)).toBe('34567890');
  });

  it('times out slow promises', async () => {
    await expect(__test__.withTimeoutMs(new Promise(() => {}), 10, 'timeout')).rejects.toThrow('timeout');
  });

  it('prefers the real Electron app target over DevTools and blank pages', () => {
    const target = __test__.selectCDPTarget([
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

    const target = __test__.selectCDPTarget([
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

  it('boosts ChatGPT targets during generic CDP target scoring', () => {
    const target = __test__.selectCDPTarget([
      {
        type: 'page',
        title: 'Session Overview',
        url: 'https://example.com/dashboard',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9224/other',
      },
      {
        type: 'page',
        title: 'ChatGPT',
        url: 'https://chatgpt.com/?window_style=main_view',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9224/chatgpt',
      },
    ]);

    expect(target?.webSocketDebuggerUrl).toBe('ws://127.0.0.1:9224/chatgpt');
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

    await expect(mcp.connect()).rejects.toThrow('Browser Extension is not connected');
  });
});
