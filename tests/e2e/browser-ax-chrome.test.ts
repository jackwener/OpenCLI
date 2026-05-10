import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const EXTENSION_DIR = path.join(ROOT, 'extension');
const DAEMON_PORT = 19825;

type Command = {
  id: string;
  action: string;
  workspace?: string;
  page?: string;
  url?: string;
  cdpMethod?: string;
  cdpParams?: Record<string, unknown>;
};

type Result = {
  id: string;
  ok: boolean;
  data?: unknown;
  page?: string;
  error?: string;
};

type FakeBridge = {
  close: () => Promise<void>;
  waitForExtension: () => Promise<void>;
  sendCommand: (command: Omit<Command, 'id'>) => Promise<Result>;
};

type TestSite = {
  url: string;
  close: () => Promise<void>;
};

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function startFakeBridge(): Promise<FakeBridge | null> {
  let ws: WebSocket | null = null;
  let nextId = 0;
  const pending = new Map<string, (result: Result) => void>();
  let resolveConnected: (() => void) | null = null;
  const connected = new Promise<void>((resolve) => {
    resolveConnected = resolve;
  });

  const server = createServer((req, res) => {
    const pathname = req.url?.split('?')[0] ?? '/';
    if (req.method === 'GET' && pathname === '/ping') {
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === 'GET' && pathname === '/status') {
      json(res, 200, {
        ok: true,
        pid: process.pid,
        uptime: 1,
        daemonVersion: 'e2e',
        extensionConnected: ws?.readyState === ws?.OPEN,
        extensionVersion: 'e2e',
        pending: pending.size,
        memoryMB: 1,
        port: DAEMON_PORT,
      });
      return;
    }
    json(res, 404, { ok: false, error: 'Not found' });
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ext') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => {
      ws = client;
      client.on('message', (raw) => {
        const msg = JSON.parse(raw.toString()) as Result | { type?: string };
        if ('type' in msg && msg.type === 'hello') {
          resolveConnected?.();
          return;
        }
        if ('id' in msg) {
          const resolver = pending.get(msg.id);
          if (resolver) {
            pending.delete(msg.id);
            resolver(msg);
          }
        }
      });
    });
  });

  const listening = await new Promise<boolean>((resolve, reject) => {
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
        return;
      }
      reject(err);
    });
    // The extension connects to "localhost", which can resolve to IPv6 first
    // on macOS. Bind all loopback-capable interfaces so the smoke does not
    // depend on local resolver ordering.
    server.listen(DAEMON_PORT, () => resolve(true));
  });
  if (!listening) return null;

  return {
    close: async () => {
      ws?.close();
      wss.close();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => err ? reject(err) : resolve());
      });
    },
    waitForExtension: () => withTimeout(connected, 15_000, 'Timed out waiting for Browser Bridge extension to connect'),
    sendCommand: async (command) => {
      if (!ws || ws.readyState !== ws.OPEN) throw new Error('Extension WebSocket is not connected');
      const id = `ax-e2e-${++nextId}`;
      const result = new Promise<Result>((resolve) => {
        pending.set(id, resolve);
      });
      ws.send(JSON.stringify({ id, ...command }));
      return withTimeout(result, 30_000, `Timed out waiting for ${command.action}/${command.cdpMethod ?? ''}`);
    },
  };
}

async function startTestSite(): Promise<TestSite> {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://a.opencli.test');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (url.pathname === '/same-frame') {
      res.end('<!doctype html><button>Same Frame Button</button>');
      return;
    }
    if (url.pathname === '/cross-frame') {
      res.end('<!doctype html><button>Cross Frame Button</button>');
      return;
    }
    res.end(`<!doctype html>
      <main>
        <button>Parent Button</button>
        <iframe title="same frame" src="/same-frame"></iframe>
        <iframe title="cross frame" src="http://b.opencli.test:${addressPort(server)}/cross-frame"></iframe>
      </main>`);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = addressPort(server);
  return {
    url: `http://a.opencli.test:${port}/`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => err ? reject(err) : resolve());
      });
    },
  };
}

function addressPort(server: ReturnType<typeof createServer>): number {
  const address = server.address();
  if (!address || typeof address !== 'object') throw new Error('Server is not listening');
  return address.port;
}

function findChromeExecutable(): string | null {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter((entry): entry is string => !!entry);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  for (const binary of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const resolved = spawnSync('which', [binary], { encoding: 'utf8' });
    const found = resolved.stdout.trim();
    if (resolved.status === 0 && found) return found;
  }
  return null;
}

function launchChrome(chromePath: string, userDataDir: string, startUrl: string): ChildProcess {
  return spawn(chromePath, [
    `--user-data-dir=${userDataDir}`,
    `--disable-extensions-except=${EXTENSION_DIR}`,
    `--load-extension=${EXTENSION_DIR}`,
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    '--enable-unsafe-extension-debugging',
    '--host-resolver-rules=MAP a.opencli.test 127.0.0.1,MAP b.opencli.test 127.0.0.1',
    '--site-per-process',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-component-update',
    '--disable-popup-blocking',
    '--no-sandbox',
    '--window-size=1280,720',
    startUrl,
  ], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

async function killProcess(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function flattenFrameTree(frameTree: unknown): Array<{ id: string; url: string }> {
  const frames: Array<{ id: string; url: string }> = [];
  function visit(node: any): void {
    const frame = node?.frame;
    if (typeof frame?.id === 'string') {
      frames.push({ id: frame.id, url: String(frame.url ?? frame.unreachableUrl ?? '') });
    }
    for (const child of node?.childFrames ?? []) visit(child);
  }
  visit((frameTree as any)?.frameTree);
  return frames;
}

function axText(axTree: unknown): string {
  const nodes = Array.isArray((axTree as any)?.nodes) ? (axTree as any).nodes : [];
  return nodes.map((node: any) => String(node?.name?.value ?? '')).join('\n');
}

describe('Browser Bridge AX real Chrome smoke', () => {
  let bridge: FakeBridge | null = null;
  let site: TestSite | null = null;
  let chrome: ChildProcess | null = null;
  let chromeStderr = '';
  let userDataDir = '';
  let skipReason = '';

  beforeAll(async () => {
    bridge = await startFakeBridge();
    if (!bridge) {
      skipReason = process.env.CI
        ? 'Port 19825 is already in use in CI'
        : 'Port 19825 is already in use; stop opencli daemon before running this e2e smoke locally';
      return;
    }

    const chromePath = findChromeExecutable();
    if (!chromePath) {
      skipReason = 'Chrome executable not found';
      return;
    }

    site = await startTestSite();
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-ax-chrome-'));
    chrome = launchChrome(chromePath, userDataDir, 'about:blank');
    chrome.stderr?.on('data', (chunk) => {
      chromeStderr += chunk.toString();
      if (chromeStderr.length > 20_000) chromeStderr = chromeStderr.slice(-20_000);
    });
    try {
      await bridge.waitForExtension();
    } catch (err) {
      const tail = chromeStderr.split('\n').slice(-30).join('\n').trim();
      const message = `${err instanceof Error ? err.message : String(err)}${tail ? `\nChrome stderr:\n${tail}` : ''}`;
      if (process.env.CI) throw new Error(message);
      skipReason = message;
    }
  }, 30_000);

  afterAll(async () => {
    await killProcess(chrome);
    await site?.close();
    await bridge?.close();
    if (userDataDir) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          fs.rmSync(userDataDir, { recursive: true, force: true });
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
    }
  });

  it('returns AX nodes for parent and same-origin iframe, and probes cross-origin frame support', async () => {
    if (skipReason) {
      if (process.env.CI) throw new Error(skipReason);
      console.warn(`skipped — ${skipReason}`);
      return;
    }
    expect(bridge).toBeTruthy();
    expect(site).toBeTruthy();

    const workspace = `browser:ax-smoke-${Date.now()}`;
    const nav = await bridge!.sendCommand({ action: 'navigate', workspace, url: site!.url });
    expect(nav.ok, nav.error).toBe(true);
    expect(nav.page).toBeTruthy();

    const rootEnable = await bridge!.sendCommand({
      action: 'cdp',
      workspace,
      page: nav.page,
      cdpMethod: 'Accessibility.enable',
      cdpParams: {},
    });
    expect(rootEnable.ok, rootEnable.error).toBe(true);

    const rootAx = await bridge!.sendCommand({
      action: 'cdp',
      workspace,
      page: nav.page,
      cdpMethod: 'Accessibility.getFullAXTree',
      cdpParams: {},
    });
    expect(rootAx.ok, rootAx.error).toBe(true);
    expect(axText(rootAx.data)).toContain('Parent Button');

    const frameTree = await bridge!.sendCommand({
      action: 'cdp',
      workspace,
      page: nav.page,
      cdpMethod: 'Page.getFrameTree',
      cdpParams: {},
    });
    expect(frameTree.ok, frameTree.error).toBe(true);
    const frames = flattenFrameTree(frameTree.data);
    const sameFrame = frames.find((frame) => frame.url.includes('/same-frame'));
    const crossFrame = frames.find((frame) => frame.url.includes('/cross-frame'));
    expect(sameFrame).toBeTruthy();
    expect(crossFrame).toBeTruthy();

    const sameAx = await bridge!.sendCommand({
      action: 'cdp',
      workspace,
      page: nav.page,
      cdpMethod: 'Accessibility.getFullAXTree',
      cdpParams: { frameId: sameFrame!.id },
    });
    expect(sameAx.ok, sameAx.error).toBe(true);
    expect(axText(sameAx.data)).toContain('Same Frame Button');

    const crossEnable = await bridge!.sendCommand({
      action: 'cdp',
      workspace,
      page: nav.page,
      cdpMethod: 'Accessibility.enable',
      cdpParams: { frameId: crossFrame!.id, sessionId: 'target', targetUrl: crossFrame!.url },
    });
    if (!crossEnable.ok) {
      expect(crossEnable.error).toMatch(/No iframe target found|No target with given id|not supported/i);
      return;
    }

    const crossAx = await bridge!.sendCommand({
      action: 'cdp',
      workspace,
      page: nav.page,
      cdpMethod: 'Accessibility.getFullAXTree',
      cdpParams: { frameId: crossFrame!.id, sessionId: 'target', targetUrl: crossFrame!.url },
    });
    expect(crossAx.ok, crossAx.error).toBe(true);
    expect(axText(crossAx.data)).toContain('Cross Frame Button');
  }, 60_000);
});
