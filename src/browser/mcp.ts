/**
 * Playwright MCP process manager.
 * Handles lifecycle management, JSON-RPC communication, and browser session orchestration.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import type { IPage } from '../types.js';
import { withTimeoutMs, DEFAULT_BROWSER_CONNECT_TIMEOUT } from '../runtime.js';
import { PKG_VERSION } from '../version.js';
import { Page } from './page.js';
import { getTokenFingerprint, formatBrowserConnectError, inferConnectFailureKind } from './errors.js';
import { findMcpServerPath, buildMcpLaunchSpec, resolveCdpEndpoint } from './discover.js';
import { extractTabIdentities, extractTabEntries, diffTabIndexes, appendLimited } from './tabs.js';

const STDERR_BUFFER_LIMIT = 16 * 1024;
const INITIAL_TABS_TIMEOUT_MS = 1500;
const TAB_CLEANUP_TIMEOUT_MS = 2000;

export type PlaywrightMCPState = 'idle' | 'connecting' | 'connected' | 'closing' | 'closed';

// JSON-RPC helpers
let _nextId = 1;
export function createJsonRpcRequest(method: string, params: Record<string, unknown> = {}): { id: number; message: string } {
  const id = _nextId++;
  return {
    id,
    message: JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n',
  };
}

/**
 * Playwright MCP process manager.
 */
export class PlaywrightMCP {
  private static _activeInsts: Set<PlaywrightMCP> = new Set();
  private static _cleanupRegistered = false;

  private static _registerGlobalCleanup() {
    if (this._cleanupRegistered) return;
    this._cleanupRegistered = true;
    const cleanup = () => {
      for (const inst of this._activeInsts) {
        if (inst._proc && !inst._proc.killed) {
          try { inst._proc.kill('SIGKILL'); } catch {}
        }
      }
    };
    process.on('exit', cleanup);
    process.on('SIGINT', () => { cleanup(); process.exit(130); });
    process.on('SIGTERM', () => { cleanup(); process.exit(143); });
  }

  private _proc: ChildProcess | null = null;
  private _buffer = '';
  private _pending = new Map<number, { resolve: (data: any) => void; reject: (error: Error) => void }>();
  private _initialTabIdentities: string[] = [];
  private _closingPromise: Promise<void> | null = null;
  private _state: PlaywrightMCPState = 'idle';

  private _page: Page | null = null;

  get state(): PlaywrightMCPState {
    return this._state;
  }

  private _sendRequest(method: string, params: Record<string, unknown> = {}): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      if (!this._proc?.stdin?.writable) {
        reject(new Error('Playwright MCP process is not writable'));
        return;
      }
      const { id, message } = createJsonRpcRequest(method, params);
      this._pending.set(id, { resolve, reject });
      this._proc.stdin.write(message, (err) => {
        if (!err) return;
        this._pending.delete(id);
        reject(err);
      });
    });
  }

  private _rejectPendingRequests(error: Error): void {
    const pending = [...this._pending.values()];
    this._pending.clear();
    for (const waiter of pending) waiter.reject(error);
  }

  private _resetAfterFailedConnect(): void {
    const proc = this._proc;
    this._page = null;
    this._proc = null;
    this._buffer = '';
    this._initialTabIdentities = [];
    this._rejectPendingRequests(new Error('Playwright MCP connect failed'));
    PlaywrightMCP._activeInsts.delete(this);
    if (proc && !proc.killed) {
      try { proc.kill('SIGKILL'); } catch {}
    }
  }

  async connect(opts: { timeout?: number; headless?: boolean; caps?: string[] } = {}): Promise<IPage> {
    if (this._state === 'connected' && this._page) return this._page;
    if (this._state === 'connecting') throw new Error('Playwright MCP is already connecting');
    if (this._state === 'closing') throw new Error('Playwright MCP is closing');
    if (this._state === 'closed') throw new Error('Playwright MCP session is closed');

    const mcpPath = findMcpServerPath();

    PlaywrightMCP._registerGlobalCleanup();
    PlaywrightMCP._activeInsts.add(this);
    this._state = 'connecting';
    const timeout = opts.timeout ?? DEFAULT_BROWSER_CONNECT_TIMEOUT;
    const headless = opts.headless;

    return new Promise<Page>((resolve, reject) => {
      const isDebug = process.env.DEBUG?.includes('opencli:mcp');
      const debugLog = (msg: string) => isDebug && console.error(`[opencli:mcp] ${msg}`);
      const { endpoint: cdpEndpoint, requestedCdp } = resolveCdpEndpoint();
      const useExtension = !requestedCdp;
      const extensionToken = process.env.PLAYWRIGHT_MCP_EXTENSION_TOKEN;
      const tokenFingerprint = getTokenFingerprint(extensionToken);
      let stderrBuffer = '';
      let settled = false;

      const settleError = (kind: Parameters<typeof formatBrowserConnectError>[0]['kind'], extra: { rawMessage?: string; exitCode?: number | null } = {}) => {
        if (settled) return;
        settled = true;
        this._state = 'idle';
        clearTimeout(timer);
        this._resetAfterFailedConnect();
        reject(formatBrowserConnectError({
          kind,
          timeout,
          hasExtensionToken: !!extensionToken,
          tokenFingerprint,
          stderr: stderrBuffer,
          exitCode: extra.exitCode,
          rawMessage: extra.rawMessage,
        }));
      };

      const settleSuccess = (pageToResolve: Page) => {
        if (settled) return;
        settled = true;
        this._state = 'connected';
        clearTimeout(timer);
        resolve(pageToResolve);
      };

      const timer = setTimeout(() => {
        debugLog('Connection timed out');
        settleError(inferConnectFailureKind({
          hasExtensionToken: !!extensionToken,
          stderr: stderrBuffer,
          isCdpMode: requestedCdp,
        }));
      }, timeout * 1000);

      const launchSpec = buildMcpLaunchSpec({
        mcpPath,
        executablePath: process.env.OPENCLI_BROWSER_EXECUTABLE_PATH,
        cdpEndpoint,
        headless,
        caps: opts.caps,
      });
      const isHeadless = launchSpec.headless;
      if (process.env.OPENCLI_VERBOSE) {
        console.error(`[opencli] Mode: ${isHeadless ? 'headless' : requestedCdp ? 'CDP' : useExtension ? 'extension' : 'standalone'}`);
        // Extension token is irrelevant in headless mode (--extension is not passed)
        if (useExtension && !isHeadless) console.error(`[opencli] Extension token: fingerprint ${tokenFingerprint}`);
        if (launchSpec.usedNpxFallback) {
          console.error('[opencli] Playwright MCP not found locally; bootstrapping via npx @playwright/mcp@latest');
        }
      }
      debugLog(`Spawning ${launchSpec.command} ${launchSpec.args.join(' ')}`);

      this._proc = spawn(launchSpec.command, launchSpec.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      // Increase max listeners to avoid warnings
      this._proc.setMaxListeners(20);
      if (this._proc.stdout) this._proc.stdout.setMaxListeners(20);

      const page = new Page((method, params = {}) => this._sendRequest(method, params));
      this._page = page;

      this._proc.stdout?.on('data', (chunk: Buffer) => {
        this._buffer += chunk.toString();
        const lines = this._buffer.split('\n');
        this._buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          debugLog(`RECV: ${line}`);
          try {
            const parsed = JSON.parse(line);
            if (typeof parsed?.id === 'number') {
              const waiter = this._pending.get(parsed.id);
              if (waiter) {
                this._pending.delete(parsed.id);
                waiter.resolve(parsed);
              }
            }
          } catch (e) {
            debugLog(`Parse error: ${e}`);
          }
        }
      });

      this._proc.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderrBuffer = appendLimited(stderrBuffer, text, STDERR_BUFFER_LIMIT);
        debugLog(`STDERR: ${text}`);
      });
      this._proc.on('error', (err) => {
        debugLog(`Subprocess error: ${err.message}`);
        this._rejectPendingRequests(new Error(`Playwright MCP process error: ${err.message}`));
        settleError('process-exit', { rawMessage: err.message });
      });
      this._proc.on('close', (code) => {
        debugLog(`Subprocess closed with code ${code}`);
        this._rejectPendingRequests(new Error(`Playwright MCP process exited before response${code == null ? '' : ` (code ${code})`}`));
        if (!settled) {
          settleError(inferConnectFailureKind({
            hasExtensionToken: !!extensionToken,
            stderr: stderrBuffer,
            exited: true,
            isCdpMode: requestedCdp,
          }), { exitCode: code });
        }
      });

      // Initialize: send initialize request
      debugLog('Waiting for initialize response...');
      this._sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'opencli', version: PKG_VERSION },
      }).then((resp: any) => {
        debugLog('Got initialize response');
        if (resp.error) {
          settleError(inferConnectFailureKind({
            hasExtensionToken: !!extensionToken,
            stderr: stderrBuffer,
            rawMessage: `MCP init failed: ${resp.error.message}`,
            isCdpMode: requestedCdp,
          }), { rawMessage: resp.error.message });
          return;
        }
        
        const initializedMsg = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n';
        debugLog(`SEND: ${initializedMsg.trim()}`);
        this._proc?.stdin?.write(initializedMsg);

        // Use tabs as a readiness probe and for tab cleanup bookkeeping.
        debugLog('Fetching initial tabs count...');
        withTimeoutMs(page.tabs(), INITIAL_TABS_TIMEOUT_MS, 'Timed out fetching initial tabs').then((tabs: any) => {
          debugLog(`Tabs response: ${typeof tabs === 'string' ? tabs : JSON.stringify(tabs)}`);
          this._initialTabIdentities = extractTabIdentities(tabs);
          settleSuccess(page);
        }).catch((err: Error) => {
          debugLog(`Tabs fetch error: ${err.message}`);
          settleSuccess(page);
        });
      }).catch((err: Error) => {
        debugLog(`Init promise rejected: ${err.message}`);
        settleError('mcp-init', { rawMessage: err.message });
      });
    });
  }


  async close(): Promise<void> {
    if (this._closingPromise) return this._closingPromise;
    if (this._state === 'closed') return;
    this._state = 'closing';
    this._closingPromise = (async () => {
      try {
        // Extension mode opens bridge/session tabs that we can clean up best-effort.
        if (this._page && this._proc && !this._proc.killed) {
          try {
            const tabs = await withTimeoutMs(this._page.tabs(), TAB_CLEANUP_TIMEOUT_MS, 'Timed out fetching tabs during cleanup');
            const tabEntries = extractTabEntries(tabs);
            const tabsToClose = diffTabIndexes(this._initialTabIdentities, tabEntries);
            for (const index of tabsToClose) {
              try { await this._page.closeTab(index); } catch {}
            }
          } catch {}
        }
        if (this._proc && !this._proc.killed) {
          this._proc.kill('SIGTERM');
          const exited = await new Promise<boolean>((res) => {
            let done = false;
            const finish = (value: boolean) => {
              if (done) return;
              done = true;
              res(value);
            };
            this._proc?.once('exit', () => finish(true));
            setTimeout(() => finish(false), 3000);
          });
          if (!exited && this._proc && !this._proc.killed) {
            try { this._proc.kill('SIGKILL'); } catch {}
          }
        }
      } finally {
        this._rejectPendingRequests(new Error('Playwright MCP session closed'));
        this._page = null;
        this._proc = null;
        this._state = 'closed';
        PlaywrightMCP._activeInsts.delete(this);
      }
    })();
    return this._closingPromise;
  }
}
