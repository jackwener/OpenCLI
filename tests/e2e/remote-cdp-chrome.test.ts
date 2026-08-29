/**
 * Real-Chrome coverage for remote-Chrome mode (OPENCLI_CDP_ENDPOINT).
 *
 * The unit tests in src/browser/cdp.test.ts drive a hand-written DevTools HTTP
 * server, so they prove our request shapes against our own assumptions. This
 * file proves the same shapes against a browser that actually enforces them:
 * /json/new needs PUT on Chrome 111+, and it needs the ?url= query or Chrome
 * opens the profile's new-tab page instead of a blank one.
 *
 * Opt-in (needs a Chrome/Chromium binary on the machine):
 *   OPENCLI_REMOTE_CDP_E2E=1 npx vitest run --project e2e-remote-cdp
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CDPBridge, createDedicatedCDPTarget } from '../../src/browser/cdp.js';

type DevtoolsTarget = { id?: string; type?: string; url?: string };

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

async function readDevtoolsPort(userDataDir: string, timeoutMs = 20_000): Promise<number> {
  const portFile = path.join(userDataDir, 'DevToolsActivePort');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(portFile)) {
      const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]?.trim());
      if (Number.isFinite(port) && port > 0) return port;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Chrome never wrote DevToolsActivePort');
}

/**
 * Only page targets. Chrome brings its own component-extension service workers
 * up asynchronously, so a raw /json snapshot is not stable enough to diff.
 */
async function listTargets(base: string): Promise<DevtoolsTarget[]> {
  const res = await fetch(`${base}/json`);
  const targets = await res.json() as DevtoolsTarget[];
  return targets.filter((t) => t.type === 'page');
}

/**
 * Front the real DevTools HTTP endpoint, but rewrite the WebSocket URL of a
 * freshly created target to a closed port. The tab is real; the session can
 * never be established.
 */
async function startDeadSocketProxy(upstream: string): Promise<{ base: string; seen: string[]; close: () => Promise<void> }> {
  const { createServer } = await import('node:http');
  const seen: string[] = [];
  const server = createServer((req, res) => {
    void (async () => {
      const url = req.url ?? '/';
      seen.push(`${req.method ?? ''} ${url}`);
      const upstreamRes = await fetch(`${upstream}${url}`, { method: req.method });
      const text = await upstreamRes.text();
      let body = text;
      try {
        const parsed = JSON.parse(text) as { id?: string; webSocketDebuggerUrl?: string };
        if (parsed && typeof parsed === 'object' && parsed.webSocketDebuggerUrl) {
          // Port 1 is never listening.
          body = JSON.stringify({ ...parsed, webSocketDebuggerUrl: `ws://127.0.0.1:1/devtools/page/${parsed.id}` });
        }
      } catch {
        // Non-JSON bodies (/json/close) pass through untouched.
      }
      res.writeHead(upstreamRes.status, { 'Content-Type': 'application/json' });
      res.end(body);
    })().catch(() => {
      res.writeHead(500);
      res.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    seen,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const enabled = process.env.OPENCLI_REMOTE_CDP_E2E === '1';
const chromePath = enabled ? findChromeExecutable() : null;

describe.runIf(enabled && chromePath)('remote-Chrome dedicated tabs (real Chrome)', () => {
  let chrome: ChildProcess | null = null;
  let userDataDir = '';
  let base = '';

  beforeAll(async () => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-remote-cdp-'));
    chrome = spawn(chromePath!, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ], { stdio: 'ignore' });
    const port = await readDevtoolsPort(userDataDir);
    base = `http://127.0.0.1:${port}`;
  }, 60_000);

  afterAll(async () => {
    chrome?.kill('SIGKILL');
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it('creates a blank page target through PUT /json/new?url=about:blank', async () => {
    const created = await createDedicatedCDPTarget(base);

    expect(created.id).toBeTruthy();
    expect(created.type).toBe('page');
    // The ?url= query is load-bearing: without it Chrome opens the profile's
    // new-tab page, which navigates on its own and races the adapter's goto.
    expect(created.url).toBe('about:blank');
    expect(String(created.webSocketDebuggerUrl)).toMatch(/^ws:\/\//);

    await fetch(`${base}/json/close/${created.id}`);
  });

  it('rejects a bare GET /json/new, which is why the PUT-first fallback exists', async () => {
    const res = await fetch(`${base}/json/new?url=about:blank`, { method: 'GET' });

    // Chrome 111+ answers 405 here; older builds answer 200. Either way the
    // PUT-first-then-GET order in createDedicatedCDPTarget covers both.
    expect([200, 405]).toContain(res.status);
  });

  it('opens its own tab and removes it on close(), leaving the browser as it was', async () => {
    const before = await listTargets(base);
    const bridge = new CDPBridge();

    await bridge.connect({ cdpEndpoint: base, dedicatedTarget: true });
    const during = await listTargets(base);
    expect(during.length).toBe(before.length + 1);

    await bridge.close();
    // Chrome removes the target asynchronously after /json/close returns.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const after = await listTargets(base);
    expect(after.map((t) => t.id).sort()).toEqual(before.map((t) => t.id).sort());
  });

  it('leaves its tab open when keepTab is requested', async () => {
    const before = await listTargets(base);

    const bridge = new CDPBridge();
    await bridge.connect({ cdpEndpoint: base, dedicatedTarget: true, keepTab: true });
    await bridge.close();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const kept = await listTargets(base);
    expect(kept.length).toBe(before.length + 1);

    const leftover = kept.find((t) => !before.some((b) => b.id === t.id));
    expect(leftover?.url).toBe('about:blank');
    await fetch(`${base}/json/close/${leftover?.id}`);
  });

  it('removes its tab when the WebSocket handshake fails', async () => {
    const before = await listTargets(base);
    // Chrome really creates the tab; only the WebSocket URL handed back to us is
    // dead, so this exercises the exact window where a target exists but no
    // session was ever established.
    const proxy = await startDeadSocketProxy(base);
    try {
      const bridge = new CDPBridge();
      await expect(bridge.connect({
        cdpEndpoint: proxy.base,
        dedicatedTarget: true,
        keepTab: true,
        timeout: 5,
      })).rejects.toThrow();

      expect(proxy.seen).toEqual([
        expect.stringMatching(/^PUT \/json\/new\?url=about:blank$/),
        expect.stringMatching(/^GET \/json\/close\//),
      ]);
    } finally {
      await proxy.close();
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
    const after = await listTargets(base);
    expect(after.map((t) => t.id).sort()).toEqual(before.map((t) => t.id).sort());
  }, 30_000);

  it('removes its tab when navigation fails after connecting', async () => {
    const before = await listTargets(base);
    const bridge = new CDPBridge();

    const page = await bridge.connect({ cdpEndpoint: base, dedicatedTarget: true });
    // A domain that cannot resolve. Page.navigate reports the failure as an
    // error page rather than throwing on this transport, so the point here is
    // not the rejection -- it is that a command which navigated nowhere useful
    // still leaves the browser clean.
    await page.goto('http://opencli-e2e.invalid/').catch(() => {});
    await bridge.close();

    await new Promise((resolve) => setTimeout(resolve, 500));
    const after = await listTargets(base);
    expect(after.map((t) => t.id).sort()).toEqual(before.map((t) => t.id).sort());
  }, 30_000);
});
