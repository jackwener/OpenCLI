/**
 * Browser interaction via Playwright MCP Bridge extension.
 * Connects to an existing Chrome browser through the extension's stdio JSON-RPC.
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { formatSnapshot } from './snapshotFormatter.js';

// Read version from package.json (single source of truth)
const __browser_dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_VERSION = (() => { try { return JSON.parse(fs.readFileSync(path.resolve(__browser_dirname, '..', 'package.json'), 'utf-8')).version; } catch { return '0.0.0'; } })();

const EXTENSION_LOCK_TIMEOUT = parseInt(process.env.OPENCLI_EXTENSION_LOCK_TIMEOUT ?? '120', 10);
const EXTENSION_LOCK_POLL = parseInt(process.env.OPENCLI_EXTENSION_LOCK_POLL_INTERVAL ?? '1', 10);
const CONNECT_TIMEOUT = parseInt(process.env.OPENCLI_BROWSER_CONNECT_TIMEOUT ?? '30', 10);
const LOCK_DIR = path.join(os.tmpdir(), 'opencli-mcp-lock');

// JSON-RPC helpers
let _nextId = 1;
function jsonRpcRequest(method: string, params: Record<string, any> = {}): string {
  return JSON.stringify({ jsonrpc: '2.0', id: _nextId++, method, params }) + '\n';
}

import type { IPage } from './types.js';

/**
 * Page abstraction wrapping JSON-RPC calls to Playwright MCP.
 */
export class Page implements IPage {
  constructor(private _send: (msg: string) => void, private _recv: () => Promise<any>) {}

  async call(method: string, params: Record<string, any> = {}): Promise<any> {
    this._send(jsonRpcRequest(method, params));
    const resp = await this._recv();
    if (resp.error) throw new Error(`page.${method}: ${resp.error.message ?? JSON.stringify(resp.error)}`);
    // Extract text content from MCP result
    const result = resp.result;
    if (result?.content) {
      const textParts = result.content.filter((c: any) => c.type === 'text');
      if (textParts.length === 1) {
        let text = textParts[0].text;
        // MCP browser_evaluate returns: "[JSON]\n### Ran Playwright code\n```js\n...\n```"
        // Strip the "### Ran Playwright code" suffix to get clean JSON
        const codeMarker = text.indexOf('### Ran Playwright code');
        if (codeMarker !== -1) {
          text = text.slice(0, codeMarker).trim();
        }
        // Also handle "### Result\n[JSON]" format (some MCP versions)
        const resultMarker = text.indexOf('### Result\n');
        if (resultMarker !== -1) {
          text = text.slice(resultMarker + '### Result\n'.length).trim();
        }
        try { return JSON.parse(text); } catch { return text; }
      }
    }
    return result;
  }

  // --- High-level methods ---

  async goto(url: string): Promise<void> {
    await this.call('tools/call', { name: 'browser_navigate', arguments: { url } });
  }

  async evaluate(js: string): Promise<any> {
    return this.call('tools/call', { name: 'browser_evaluate', arguments: { function: js } });
  }

  async snapshot(opts: { interactive?: boolean; compact?: boolean; maxDepth?: number; raw?: boolean } = {}): Promise<any> {
    const raw = await this.call('tools/call', { name: 'browser_snapshot', arguments: {} });
    if (opts.raw) return raw;
    if (typeof raw === 'string') return formatSnapshot(raw, opts);
    return raw;
  }

  async click(ref: string): Promise<void> {
    await this.call('tools/call', { name: 'browser_click', arguments: { element: 'click target', ref } });
  }

  async typeText(ref: string, text: string): Promise<void> {
    await this.call('tools/call', { name: 'browser_type', arguments: { element: 'type target', ref, text } });
  }

  async pressKey(key: string): Promise<void> {
    await this.call('tools/call', { name: 'browser_press_key', arguments: { key } });
  }

  async wait(seconds: number): Promise<void> {
    await this.call('tools/call', { name: 'browser_wait_for', arguments: { time: seconds } });
  }

  async tabs(): Promise<any> {
    return this.call('tools/call', { name: 'browser_tabs', arguments: { action: 'list' } });
  }

  async closeTab(index?: number): Promise<void> {
    await this.call('tools/call', { name: 'browser_tabs', arguments: { action: 'close', ...(index !== undefined ? { index } : {}) } });
  }

  async newTab(): Promise<void> {
    await this.call('tools/call', { name: 'browser_tabs', arguments: { action: 'new' } });
  }

  async selectTab(index: number): Promise<void> {
    await this.call('tools/call', { name: 'browser_tabs', arguments: { action: 'select', index } });
  }

  async networkRequests(includeStatic: boolean = false): Promise<any> {
    return this.call('tools/call', { name: 'browser_network_requests', arguments: { includeStatic } });
  }

  async consoleMessages(level: string = 'info'): Promise<any> {
    return this.call('tools/call', { name: 'browser_console_messages', arguments: { level } });
  }

  async scroll(direction: string = 'down', amount: number = 500): Promise<void> {
    await this.call('tools/call', { name: 'browser_press_key', arguments: { key: direction === 'down' ? 'PageDown' : 'PageUp' } });
  }
}

/**
 * Playwright MCP process manager.
 */
export class PlaywrightMCP {
  private _proc: ChildProcess | null = null;
  private _buffer = '';
  private _waiters: Array<(data: any) => void> = [];
  private _lockAcquired = false;
  private _initialTabCount = 0;

  private _page: Page | null = null;

  async connect(opts: { timeout?: number } = {}): Promise<Page> {
    await this._acquireLock();
    const timeout = opts.timeout ?? CONNECT_TIMEOUT;
    const mcpPath = findMcpServerPath();
    if (!mcpPath) throw new Error('Playwright MCP server not found. Install: npm install -D @playwright/mcp');

    return new Promise<Page>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out connecting to browser (${timeout}s)`)), timeout * 1000);

      this._proc = spawn('node', [mcpPath, '--extension'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...(process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN ? { PLAYWRIGHT_MCP_EXTENSION_TOKEN: process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN } : {}) },
      });

      // Increase max listeners to avoid warnings
      this._proc.setMaxListeners(20);
      if (this._proc.stdout) this._proc.stdout.setMaxListeners(20);

      const page = new Page(
        (msg) => { if (this._proc?.stdin?.writable) this._proc.stdin.write(msg); },
        () => new Promise<any>((res) => { this._waiters.push(res); }),
      );
      this._page = page;

      this._proc.stdout?.on('data', (chunk: Buffer) => {
        this._buffer += chunk.toString();
        const lines = this._buffer.split('\n');
        this._buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            const waiter = this._waiters.shift();
            if (waiter) waiter(parsed);
          } catch {}
        }
      });

      this._proc.stderr?.on('data', () => {});
      this._proc.on('error', (err) => { clearTimeout(timer); reject(err); });

      // Initialize: send initialize request
      const initMsg = jsonRpcRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'opencli', version: PKG_VERSION },
      });
      this._proc.stdin?.write(initMsg);

      // Wait for initialize response, then send initialized notification
      const origRecv = () => new Promise<any>((res) => { this._waiters.push(res); });
      origRecv().then((resp) => {
        if (resp.error) { clearTimeout(timer); reject(new Error(`MCP init failed: ${resp.error.message}`)); return; }
        this._proc?.stdin?.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');

        // Get initial tab count for cleanup
        page.tabs().then((tabs: any) => {
          if (typeof tabs === 'string') {
            this._initialTabCount = (tabs.match(/Tab \d+/g) || []).length;
          } else if (Array.isArray(tabs)) {
            this._initialTabCount = tabs.length;
          }
          clearTimeout(timer);
          resolve(page);
        }).catch(() => { clearTimeout(timer); resolve(page); });
      }).catch((err) => { clearTimeout(timer); reject(err); });
    });
  }

  async close(): Promise<void> {
    try {
      // Close tabs opened during this session (site tabs + extension tabs)
      if (this._page && this._proc && !this._proc.killed) {
        try {
          const tabs = await this._page.tabs();
          const tabStr = typeof tabs === 'string' ? tabs : JSON.stringify(tabs);
          const allTabs = tabStr.match(/Tab (\d+)/g) || [];
          const currentTabCount = allTabs.length;

          // Close tabs in reverse order to avoid index shifting issues
          // Keep the original tabs that existed before the command started
          if (currentTabCount > this._initialTabCount && this._initialTabCount > 0) {
            for (let i = currentTabCount - 1; i >= this._initialTabCount; i--) {
              try { await this._page.closeTab(i); } catch {}
            }
          }
        } catch {}
      }
      if (this._proc && !this._proc.killed) {
        this._proc.kill('SIGTERM');
        await new Promise<void>((res) => { this._proc?.on('exit', () => res()); setTimeout(res, 3000); });
      }
    } finally {
      this._page = null;
      this._releaseLock();
    }
  }

  private async _acquireLock(): Promise<void> {
    const start = Date.now();
    while (true) {
      try { fs.mkdirSync(LOCK_DIR, { recursive: false }); this._lockAcquired = true; return; }
      catch (e: any) {
        if (e.code !== 'EEXIST') throw e;
        if ((Date.now() - start) / 1000 > EXTENSION_LOCK_TIMEOUT) {
          // Force remove stale lock
          try { fs.rmdirSync(LOCK_DIR); } catch {}
          continue;
        }
        await new Promise(r => setTimeout(r, EXTENSION_LOCK_POLL * 1000));
      }
    }
  }

  private _releaseLock(): void {
    if (this._lockAcquired) {
      try { fs.rmdirSync(LOCK_DIR); } catch {}
      this._lockAcquired = false;
    }
  }
}

function findMcpServerPath(): string | null {
  // Check local node_modules first (@playwright/mcp is the modern package)
  const localMcp = path.resolve('node_modules', '@playwright', 'mcp', 'cli.js');
  if (fs.existsSync(localMcp)) return localMcp;

  // Check project-relative path
  const __dirname2 = path.dirname(fileURLToPath(import.meta.url));
  const projectMcp = path.resolve(__dirname2, '..', 'node_modules', '@playwright', 'mcp', 'cli.js');
  if (fs.existsSync(projectMcp)) return projectMcp;

  // Check common locations
  const candidates = [
    path.join(os.homedir(), '.npm', '_npx'),
    path.join(os.homedir(), 'node_modules', '.bin'),
    '/usr/local/lib/node_modules',
  ];

  // Try npx resolution (legacy package name)
  try {
    const result = execSync('npx -y --package=@playwright/mcp which mcp-server-playwright 2>/dev/null', { encoding: 'utf-8', timeout: 10000 }).trim();
    if (result && fs.existsSync(result)) return result;
  } catch {}

  // Try which
  try {
    const result = execSync('which mcp-server-playwright 2>/dev/null', { encoding: 'utf-8', timeout: 5000 }).trim();
    if (result && fs.existsSync(result)) return result;
  } catch {}

  // Search in common npx cache
  for (const base of candidates) {
    if (!fs.existsSync(base)) continue;
    try {
      const found = execSync(`find "${base}" -name "cli.js" -path "*playwright*mcp*" 2>/dev/null | head -1`, { encoding: 'utf-8', timeout: 5000 }).trim();
      if (found) return found;
    } catch {}
  }

  return null;
}
