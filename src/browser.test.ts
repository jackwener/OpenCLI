import { afterEach, describe, it, expect, vi } from 'vitest';
import { PlaywrightMCP, __test__ } from './browser/index.js';

afterEach(() => {
  __test__.resetMcpServerPathCache();
  __test__.setMcpDiscoveryTestHooks();
  delete process.env.OPENCLI_MCP_SERVER_PATH;
});

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

  it('builds extension MCP args in local mode (no CI)', () => {
    const savedCI = process.env.CI;
    delete process.env.CI;
    try {
      expect(__test__.buildMcpArgs({
        mcpPath: '/tmp/cli.js',
        executablePath: '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
      })).toEqual({ args: ['/tmp/cli.js', '--extension', '--executable-path', '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe'], headless: false });

      expect(__test__.buildMcpArgs({
        mcpPath: '/tmp/cli.js',
      })).toEqual({ args: ['/tmp/cli.js', '--extension'], headless: false });
    } finally {
      if (savedCI !== undefined) {
        process.env.CI = savedCI;
      } else {
        delete process.env.CI;
      }
    }
  });

  it('builds standalone MCP args in CI mode', () => {
    const savedCI = process.env.CI;
    const savedHeadless = process.env.OPENCLI_HEADLESS;
    const savedUserDataDir = process.env.OPENCLI_USER_DATA_DIR;
    process.env.CI = 'true';
    delete process.env.OPENCLI_HEADLESS;
    delete process.env.OPENCLI_USER_DATA_DIR;
    try {
      // CI mode: no --extension — browser launches in standalone headed mode with persistent user data
      const defaultDataDir = __test__.defaultUserDataDir();
      expect(__test__.buildMcpArgs({
        mcpPath: '/tmp/cli.js',
      })).toEqual({ args: ['/tmp/cli.js', '--user-data-dir', defaultDataDir], headless: false });

      expect(__test__.buildMcpArgs({
        mcpPath: '/tmp/cli.js',
        executablePath: '/usr/bin/chromium',
      })).toEqual({ args: ['/tmp/cli.js', '--executable-path', '/usr/bin/chromium', '--user-data-dir', defaultDataDir], headless: false });
    } finally {
      if (savedCI !== undefined) process.env.CI = savedCI;
      else delete process.env.CI;
      if (savedHeadless !== undefined) process.env.OPENCLI_HEADLESS = savedHeadless;
      else delete process.env.OPENCLI_HEADLESS;
      if (savedUserDataDir !== undefined) process.env.OPENCLI_USER_DATA_DIR = savedUserDataDir;
      else delete process.env.OPENCLI_USER_DATA_DIR;
    }
  });

  it('builds headless MCP args without session file', () => {
    const savedCI = process.env.CI;
    const savedHeadless = process.env.OPENCLI_HEADLESS;
    delete process.env.CI;
    delete process.env.OPENCLI_HEADLESS;
    try {
      // headless: no --extension, no --user-data-dir; sessionFile: null disables session lookup
      expect(__test__.buildMcpArgs({
        mcpPath: '/tmp/cli.js',
        headless: true,
        sessionFile: null,
      })).toEqual({ args: ['/tmp/cli.js', '--headless'], headless: true });
    } finally {
      if (savedCI !== undefined) process.env.CI = savedCI;
      else delete process.env.CI;
      if (savedHeadless !== undefined) process.env.OPENCLI_HEADLESS = savedHeadless;
      else delete process.env.OPENCLI_HEADLESS;
    }
  });

  it('builds headless MCP args with session file and caps', () => {
    const savedCI = process.env.CI;
    const savedHeadless = process.env.OPENCLI_HEADLESS;
    delete process.env.CI;
    delete process.env.OPENCLI_HEADLESS;
    try {
      expect(__test__.buildMcpArgs({
        mcpPath: '/tmp/cli.js',
        headless: true,
        sessionFile: '/tmp/session.json',
        caps: ['storage'],
      })).toEqual({ args: ['/tmp/cli.js', '--headless', '--storage-state', '/tmp/session.json', '--caps', 'storage'], headless: true });
    } finally {
      if (savedCI !== undefined) process.env.CI = savedCI;
      else delete process.env.CI;
      if (savedHeadless !== undefined) process.env.OPENCLI_HEADLESS = savedHeadless;
      else delete process.env.OPENCLI_HEADLESS;
    }
  });

  it('builds a direct node launch spec when a local MCP path is available', () => {
    const savedCI = process.env.CI;
    delete process.env.CI;
    try {
      expect(__test__.buildMcpLaunchSpec({
        mcpPath: '/tmp/cli.js',
        executablePath: '/usr/bin/google-chrome',
      })).toEqual({
        command: 'node',
        args: ['/tmp/cli.js', '--extension', '--executable-path', '/usr/bin/google-chrome'],
        usedNpxFallback: false,
      });
    } finally {
      if (savedCI !== undefined) {
        process.env.CI = savedCI;
      } else {
        delete process.env.CI;
      }
    }
  });

  it('falls back to npx bootstrap when no MCP path is available', () => {
    const savedCI = process.env.CI;
    delete process.env.CI;
    try {
      expect(__test__.buildMcpLaunchSpec({
        mcpPath: null,
      })).toEqual({
        command: 'npx',
        args: ['-y', '@playwright/mcp@latest', '--extension'],
        usedNpxFallback: true,
      });
    } finally {
      if (savedCI !== undefined) {
        process.env.CI = savedCI;
      } else {
        delete process.env.CI;
      }
    }
  });

  it('times out slow promises', async () => {
    await expect(__test__.withTimeoutMs(new Promise(() => {}), 10, 'timeout')).rejects.toThrow('timeout');
  });

  it('prefers OPENCLI_MCP_SERVER_PATH over discovered locations', () => {
    process.env.OPENCLI_MCP_SERVER_PATH = '/env/mcp/cli.js';
    const existsSync = vi.fn((candidate: any) => candidate === '/env/mcp/cli.js');
    const execSync = vi.fn();
    __test__.setMcpDiscoveryTestHooks({ existsSync, execSync: execSync as any });

    expect(__test__.findMcpServerPath()).toBe('/env/mcp/cli.js');
    expect(execSync).not.toHaveBeenCalled();
    expect(existsSync).toHaveBeenCalledWith('/env/mcp/cli.js');
  });

  it('discovers global @playwright/mcp from the current Node runtime prefix', () => {
    const originalExecPath = process.execPath;
    const runtimeExecPath = '/opt/homebrew/Cellar/node/25.2.1/bin/node';
    const runtimeGlobalMcp = '/opt/homebrew/Cellar/node/25.2.1/lib/node_modules/@playwright/mcp/cli.js';
    Object.defineProperty(process, 'execPath', {
      value: runtimeExecPath,
      configurable: true,
    });

    const existsSync = vi.fn((candidate: any) => candidate === runtimeGlobalMcp);
    const execSync = vi.fn();
    __test__.setMcpDiscoveryTestHooks({ existsSync, execSync: execSync as any });

    try {
      expect(__test__.findMcpServerPath()).toBe(runtimeGlobalMcp);
      expect(execSync).not.toHaveBeenCalled();
      expect(existsSync).toHaveBeenCalledWith(runtimeGlobalMcp);
    } finally {
      Object.defineProperty(process, 'execPath', {
        value: originalExecPath,
        configurable: true,
      });
    }
  });

  it('falls back to npm root -g when runtime prefix lookup misses', () => {
    const originalExecPath = process.execPath;
    const runtimeExecPath = '/opt/homebrew/Cellar/node/25.2.1/bin/node';
    const runtimeGlobalMcp = '/opt/homebrew/Cellar/node/25.2.1/lib/node_modules/@playwright/mcp/cli.js';
    const npmRootGlobal = '/Users/jakevin/.nvm/versions/node/v22.14.0/lib/node_modules';
    const npmGlobalMcp = '/Users/jakevin/.nvm/versions/node/v22.14.0/lib/node_modules/@playwright/mcp/cli.js';
    Object.defineProperty(process, 'execPath', {
      value: runtimeExecPath,
      configurable: true,
    });

    const existsSync = vi.fn((candidate: any) => candidate === npmGlobalMcp);
    const execSync = vi.fn((command: string) => {
      if (String(command).includes('npm root -g')) return `${npmRootGlobal}\n` as any;
      throw new Error(`unexpected command: ${String(command)}`);
    });
    __test__.setMcpDiscoveryTestHooks({ existsSync, execSync: execSync as any });

    try {
      expect(__test__.findMcpServerPath()).toBe(npmGlobalMcp);
      expect(execSync).toHaveBeenCalledOnce();
      expect(existsSync).toHaveBeenCalledWith(runtimeGlobalMcp);
      expect(existsSync).toHaveBeenCalledWith(npmGlobalMcp);
    } finally {
      Object.defineProperty(process, 'execPath', {
        value: originalExecPath,
        configurable: true,
      });
    }
  });

  it('returns null when new global discovery paths are unavailable', () => {
    const originalExecPath = process.execPath;
    const runtimeExecPath = '/opt/homebrew/Cellar/node/25.2.1/bin/node';
    Object.defineProperty(process, 'execPath', {
      value: runtimeExecPath,
      configurable: true,
    });

    const existsSync = vi.fn(() => false);
    const execSync = vi.fn((command: string) => {
      if (String(command).includes('npm root -g')) return '/missing/global/node_modules\n' as any;
      throw new Error(`missing command: ${String(command)}`);
    });
    __test__.setMcpDiscoveryTestHooks({ existsSync, execSync: execSync as any });

    try {
      expect(__test__.findMcpServerPath()).toBeNull();
    } finally {
      Object.defineProperty(process, 'execPath', {
        value: originalExecPath,
        configurable: true,
      });
    }
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


});
