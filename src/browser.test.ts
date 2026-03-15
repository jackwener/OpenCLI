import { describe, it, expect } from 'vitest';
import { PlaywrightMCP, __test__ } from './browser.js';

describe('browser helpers', () => {
  it('creates JSON-RPC requests with unique ids', () => {
    const first = __test__.createJsonRpcRequest('tools/call', { name: 'browser_tabs' });
    const second = __test__.createJsonRpcRequest('tools/call', { name: 'browser_snapshot' });

    expect(second.id).toBe(first.id + 1);
    expect(first.message).toContain(`"id":${first.id}`);
    expect(second.message).toContain(`"id":${second.id}`);
  });

  it('extracts tab entries from string snapshots', () => {
    const entries = __test__.extractTabEntries('Tab 0 https://example.com\nTab 1 Chrome Extension');

    expect(entries).toEqual([
      { index: 0, identity: 'https://example.com' },
      { index: 1, identity: 'Chrome Extension' },
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

  it('builds Playwright MCP args with kebab-case executable path', () => {
    expect(__test__.buildMcpArgs({
      mcpPath: '/tmp/cli.js',
      executablePath: '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
    })).toEqual([
      '/tmp/cli.js',
      '--extension',
      '--executable-path',
      '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
    ]);

    expect(__test__.buildMcpArgs({
      mcpPath: '/tmp/cli.js',
      cdpEndpoint: 'ws://127.0.0.1:9222/devtools/browser/abc',
      executablePath: '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
    })).toEqual([
      '/tmp/cli.js',
      '--cdp-endpoint',
      'ws://127.0.0.1:9222/devtools/browser/abc',
      '--executable-path',
      '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
    ]);
  });

  it('times out slow promises', async () => {
    await expect(__test__.withTimeout(new Promise(() => {}), 10, 'timeout')).rejects.toThrow('timeout');
  });
});

describe('PlaywrightMCP state', () => {
  it('transitions to closed after close()', async () => {
    const mcp = new PlaywrightMCP();

    expect(mcp.state).toBe('idle');

    await mcp.close();

    expect(mcp.state).toBe('closed');
  });

  it('rejects connect() after the session has been closed', async () => {
    const mcp = new PlaywrightMCP();
    await mcp.close();

    await expect(mcp.connect()).rejects.toThrow('Playwright MCP session is closed');
  });

  it('rejects connect() while already connecting', async () => {
    const mcp = new PlaywrightMCP();
    (mcp as any)._state = 'connecting';

    await expect(mcp.connect()).rejects.toThrow('Playwright MCP is already connecting');
  });

  it('rejects connect() while closing', async () => {
    const mcp = new PlaywrightMCP();
    (mcp as any)._state = 'closing';

    await expect(mcp.connect()).rejects.toThrow('Playwright MCP is closing');
  });

  it('tracks backend mode for lifecycle policy', async () => {
    const mcp = new PlaywrightMCP();

    expect((mcp as any)._mode).toBeNull();

    await mcp.close();

    expect((mcp as any)._mode).toBeNull();
  });
});
