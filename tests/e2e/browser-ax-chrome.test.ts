import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { CDPBridge } from '../../src/browser/cdp.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
// Overrides apply only to this test harness, allowing an isolated extension copy
// to run beside a developer's normal Browser Bridge daemon.
const EXTENSION_DIR = process.env.OPENCLI_E2E_EXTENSION_DIR || path.join(ROOT, 'extension');
const DAEMON_PORT = Number(process.env.OPENCLI_E2E_BRIDGE_PORT || 19825);

type Command = {
  id: string;
  action: string;
  session?: string;
  surface?: 'browser' | 'adapter';
  page?: string;
  url?: string;
  code?: string;
  files?: string[];
  selector?: string;
  windowMode?: 'foreground' | 'background';
  retainIncomplete?: boolean;
  pattern?: string;
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
  releaseCapture: () => void;
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
    waitForExtension: () => withTimeout(connected, 45_000, 'Timed out waiting for Browser Bridge extension to connect'),
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
  const pending = new Set<ServerResponse>();
  const releaseCapture = () => { for (const res of pending) res.end('true}'); pending.clear(); };
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://a.opencli.test');
    if (url.pathname === '/capture-start') {
      res.writeHead(302, { Location: '/capture-held' });
      res.end();
      return;
    }
    if (url.pathname === '/capture-held') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"done":');
      pending.add(res);
      res.on('close', () => pending.delete(res));
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (url.pathname === '/upload') {
      res.end(`<!doctype html>
        <style>.zero { width:0; height:0; opacity:0 }</style>
        <input type="file" id="visible">
        <input type="file" id="display" style="display:none">
        <input type="file" id="zero" class="zero">
        <input type="file" id="multiple" multiple>
        <div style="display:none"><input type="file" id="ancestor"></div>
        <input type="file" id="overlay" style="opacity:0; width:100px; height:30px">
        <input type="file" id="hidden" hidden>
        <input type="file" id="disabled" disabled style="display:none">
        <script>
          window.uploadEvents = [];
          for (const type of ['input', 'change']) document.addEventListener(type, event => {
            window.uploadEvents.push({ id:event.target.id, type, trusted:event.isTrusted,
              files:Array.from(event.target.files || [], file => file.name) });
          });
        </script>`);
      return;
    }
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
    releaseCapture,
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
    // Headed by default under a real/virtual display (CI Linux runs this under
    // xvfb). New-headless is convenient locally — no display needed — but on
    // hosted runners it does not reliably start the MV3 extension service
    // worker, so CI forces headed via OPENCLI_E2E_HEADED=1. Set OPENCLI_E2E_
    // HEADLESS=1 to opt into headless locally.
    ...(process.env.OPENCLI_E2E_HEADLESS === '1' && process.env.OPENCLI_E2E_HEADED !== '1'
      ? ['--headless=new']
      : []),
    `--user-data-dir=${userDataDir}`,
    '--remote-debugging-port=0',
    `--disable-extensions-except=${EXTENSION_DIR}`,
    `--load-extension=${EXTENSION_DIR}`,
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    '--enable-unsafe-extension-debugging',
    '--host-resolver-rules=MAP a.opencli.test 127.0.0.1,MAP b.opencli.test 127.0.0.1',
    '--site-per-process',
    '--no-proxy-server',
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

function shouldFailOnBridgeUnavailable(): boolean {
  // In CI this smoke is scheduled only on Linux (headed under xvfb — the one
  // hosted environment where a real Chrome reliably starts an MV3 extension),
  // so any bridge failure there is a real product/packaging regression and
  // must block. macOS/Windows gate on the browser-free transport contracts
  // instead; see the e2e-headed workflow for the rationale.
  return process.env.CI === 'true';
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
        ? `Port ${DAEMON_PORT} is already in use in CI`
        : `Port ${DAEMON_PORT} is already in use; use an isolated extension copy and OPENCLI_E2E_BRIDGE_PORT locally`;
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
      if (shouldFailOnBridgeUnavailable()) throw new Error(message);
      skipReason = message;
    }
  }, 60_000);

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

  it('retains a redirected streaming response across reads in both backends', async () => {
    if (skipReason) {
      if (shouldFailOnBridgeUnavailable()) throw new Error(skipReason);
      console.warn(`skipped — ${skipReason}`);
      return;
    }
    const script = `(() => { void fetch('/capture-start', { method: 'POST', body: 'original payload' }).then(r => r.text()); return true; })()`;
    const port = fs.readFileSync(path.join(userDataDir, 'DevToolsActivePort'), 'utf8').split('\n')[0];
    const direct = new CDPBridge();
    try {
      const page = await direct.connect({ cdpEndpoint: `http://127.0.0.1:${port}` });
      for (const backend of ['direct', 'extension']) {
        const session = `capture-${backend}-${Date.now()}`;
        const command = async (cmd: Omit<Command, 'id'>) => {
          const result = await bridge!.sendCommand({ ...cmd, session, surface: 'browser' });
          expect(result.ok, result.error).toBe(true);
          return result.data;
        };
        if (backend === 'direct') {
          await page.goto(new URL('/same-frame', site!.url).href);
          await page.startNetworkCapture?.('capture-');
          await page.evaluate(script);
        } else {
          await command({ action: 'navigate', url: new URL('/same-frame', site!.url).href });
          await command({ action: 'network-capture-start', pattern: 'capture-' });
          await command({ action: 'exec', code: script });
        }
        const read = async () => (backend === 'direct'
          ? await page.readNetworkCapture?.({ retainIncomplete: true })
          : await command({ action: 'network-capture-read', retainIncomplete: true })) as Array<Record<string, unknown>>;
        const poll = async (complete: boolean) => {
          for (let i = 0; i < 100; i++) {
            const entries = await read();
            const entry = entries.find(item => item.responseStatus === 200 && (item.captureComplete === true) === complete);
            if (entry) { expect(entries).toHaveLength(1); return entry; }
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          throw new Error(`${backend}: missing ${complete ? 'completed' : 'incomplete'} capture`);
        };
        const early = await poll(false);
        expect(early.responsePreview).toBeUndefined();
        site!.releaseCapture();
        const final = await poll(true);
        expect(final).toMatchObject({ requestId: early.requestId, method: 'POST', requestBodyPreview: 'original payload', responsePreview: '{"done":true}' });
        expect(await read()).toEqual([]);
      }
    } finally {
      site!.releaseCapture();
      await direct.close();
    }
  }, 60_000);

  it('closes only the owned tab through the real cleanup protocol', async () => {
    if (skipReason) {
      if (shouldFailOnBridgeUnavailable()) throw new Error(skipReason);
      console.warn(`skipped — ${skipReason}`);
      return;
    }
    const suffix = Date.now();
    const borrowed = { session: `borrowed-${suffix}`, surface: 'browser' as const };
    const bound = await bridge!.sendCommand({ action: 'bind', ...borrowed });
    expect(bound.ok, bound.error).toBe(true);
    const first = { session: `cleanup-first-${suffix}`, surface: 'adapter' as const };
    const second = { session: `cleanup-second-${suffix}`, surface: 'adapter' as const };
    const nav = await bridge!.sendCommand({ action: 'navigate', ...first, url: site!.url });
    const other = await bridge!.sendCommand({ action: 'navigate', ...second, url: site!.url });
    expect(nav.ok, nav.error).toBe(true);
    expect(other.ok, other.error).toBe(true);
    const targets = async () => {
      const port = fs.readFileSync(path.join(userDataDir, 'DevToolsActivePort'), 'utf8').split('\n')[0];
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      expect(response.ok).toBe(true);
      return (await response.json() as Array<{ id: string }>).map(target => target.id);
    };
    expect(await targets()).toContain(nav.page);
    expect(await targets()).toContain(bound.page);
    const closed = await bridge!.sendCommand({ action: 'close-owned-tab', ...first });
    expect(closed).toMatchObject({ ok: true, data: { tabCleanup: 'closed-owned-tab' } });
    expect(await targets()).not.toContain(nav.page);
    expect(await targets()).toContain(other.page);
    expect(await targets()).toContain(bound.page);
    expect(await bridge!.sendCommand({ action: 'close-owned-tab', ...first }))
      .toMatchObject({ ok: true, data: { tabCleanup: 'no-owned-tab' } });
    expect(await bridge!.sendCommand({ action: 'close-owned-tab', ...borrowed }))
      .toMatchObject({ ok: true, data: { tabCleanup: 'no-owned-tab' } });
    expect(await targets()).toContain(bound.page);
    expect(await bridge!.sendCommand({ action: 'exec', ...second, page: other.page, code: 'document.title' }))
      .toMatchObject({ ok: true });
    expect(await bridge!.sendCommand({ action: 'close-owned-tab', ...second }))
      .toMatchObject({ ok: true, data: { tabCleanup: 'closed-owned-tab' } });
    expect(await targets()).not.toContain(other.page);
    expect(await targets()).toContain(bound.page);
  }, 60_000);

  it('uploads through the real extension chooser on visible and hidden inputs without changing styles', async () => {
    if (skipReason) {
      if (shouldFailOnBridgeUnavailable()) throw new Error(skipReason);
      console.warn(`skipped — ${skipReason}`);
      return;
    }
    const one = path.join(userDataDir, 'one.txt');
    const two = path.join(userDataDir, 'two.txt');
    fs.writeFileSync(one, 'one');
    fs.writeFileSync(two, 'two');
    const session = { session: `upload-smoke-${Date.now()}`, surface: 'browser' as const };
    for (const [index, id] of ['visible', 'display', 'zero', 'multiple', 'ancestor', 'overlay', 'hidden', 'disabled', 'visible'].entries()) {
      const nav = await bridge!.sendCommand({ action: 'navigate', ...session,
        url: new URL(`/upload?case=${index}`, site!.url).href, windowMode: 'background' });
      expect(nav.ok, nav.error).toBe(true);
      const evaluate = async (expression: string) => {
        const result = await bridge!.sendCommand({ action: 'exec', ...session, page: nav.page, code: expression });
        expect(result.ok, result.error).toBe(true);
        return result.data;
      };
      const markup = await evaluate(`document.querySelector('#${id}').outerHTML`);
      const files = id === 'multiple' ? [one, two] : [one];
      const uploaded = await bridge!.sendCommand({ action: 'set-file-input', ...session,
        page: nav.page, selector: `#${id}`, files });
      if (id === 'disabled') {
        expect(uploaded.ok).toBe(false);
        expect(uploaded.error).toContain('Page.fileChooserOpened not received');
      } else {
        expect(uploaded.ok, `${id}: ${uploaded.error}`).toBe(true);
        const expectedNames = files.map(file => path.basename(file));
        expect(await evaluate(`Array.from(document.querySelector('#${id}').files, file => file.name)`)).toEqual(expectedNames);
        expect(await evaluate('window.uploadEvents')).toEqual(['input', 'change'].map(type => ({
          id, type, trusted: true, files: expectedNames,
        })));
      }
      expect(await evaluate(`document.querySelector('#${id}').outerHTML`)).toBe(markup);
    }
  }, 90_000);

  it('returns AX nodes for parent and same-origin iframe, and probes cross-origin frame support', async () => {
    if (skipReason) {
      if (shouldFailOnBridgeUnavailable()) throw new Error(skipReason);
      console.warn(`skipped — ${skipReason}`);
      return;
    }
    expect(bridge).toBeTruthy();
    expect(site).toBeTruthy();

    const session = `ax-smoke-${Date.now()}`;
    const browserSession = { session, surface: 'browser' as const };
    const nav = await bridge!.sendCommand({ action: 'navigate', ...browserSession, url: site!.url });
    expect(nav.ok, nav.error).toBe(true);
    expect(nav.page).toBeTruthy();

    const rootEnable = await bridge!.sendCommand({
      action: 'cdp',
      ...browserSession,
      page: nav.page,
      cdpMethod: 'Accessibility.enable',
      cdpParams: {},
    });
    expect(rootEnable.ok, rootEnable.error).toBe(true);

    const rootAx = await bridge!.sendCommand({
      action: 'cdp',
      ...browserSession,
      page: nav.page,
      cdpMethod: 'Accessibility.getFullAXTree',
      cdpParams: {},
    });
    expect(rootAx.ok, rootAx.error).toBe(true);
    expect(axText(rootAx.data)).toContain('Parent Button');

    const frameTree = await bridge!.sendCommand({
      action: 'cdp',
      ...browserSession,
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
      ...browserSession,
      page: nav.page,
      cdpMethod: 'Accessibility.getFullAXTree',
      cdpParams: { frameId: sameFrame!.id },
    });
    expect(sameAx.ok, sameAx.error).toBe(true);
    expect(axText(sameAx.data)).toContain('Same Frame Button');

    const crossEnable = await bridge!.sendCommand({
      action: 'cdp',
      ...browserSession,
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
      ...browserSession,
      page: nav.page,
      cdpMethod: 'Accessibility.getFullAXTree',
      cdpParams: { frameId: crossFrame!.id, sessionId: 'target', targetUrl: crossFrame!.url },
    });
    expect(crossAx.ok, crossAx.error).toBe(true);
    expect(axText(crossAx.data)).toContain('Cross Frame Button');
  }, 60_000);
});
