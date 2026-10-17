/**
 * Real-Chrome check of the site slot pool (OPENCLI_SITE_SLOTS) against a local
 * fixture: slot runs are isolated from each other, a slot tab renders (rAF
 * ticks, IntersectionObserver fires) even when another session's tab was
 * opened in the shared automation window since the slot's last run, and the
 * real daemon's queue/release/ownership wiring behaves as SlotAdmission says.
 *
 * Needs port 19825 free (stop any running opencli daemon first) and a browser
 * that honours --load-extension (Chromium or Chrome for Testing via CHROME_PATH;
 * branded Google Chrome ignores it). Runs are routed to the launched browser's
 * own extension contextId, never to another connected profile. Rendering
 * assertions need an unoccluded display: headed on a busy desktop, the OS can
 * mark the whole window hidden, so run locally with OPENCLI_E2E_HEADLESS=1. Opt
 * in with OPENCLI_AX_E2E=1, like the AX smoke (this file is not wired into the
 * e2e-headed CI workflow).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { executeCommand } from '../../src/execution.js';
import { cli, Strategy } from '../../src/registry.js';
import type { IPage } from '../../src/types.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DAEMON = 'http://127.0.0.1:19825';
const HEADERS = { 'X-OpenCLI': '1', 'Content-Type': 'application/json' };
// Mirrors extension/src/background.ts CONTEXT_ID_KEY.
const CONTEXT_ID_KEY = 'opencli_context_id_v1';

const FIXTURE = `<!doctype html><title>slot</title>
<div style="height:3000px">top</div><div id="sentinel">bottom</div>`;

// Counts rendering work over a short window: a background tab gets no frames,
// so rAF never ticks and IntersectionObserver never delivers.
const MEASURE = `(async () => {
  let ticks = 0, io = false, live = true;
  const tick = () => { ticks++; if (live) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  new IntersectionObserver((es) => { if (es.some(e => e.isIntersecting)) io = true; })
    .observe(document.getElementById('sentinel'));
  document.getElementById('sentinel').scrollIntoView();
  await new Promise(r => setTimeout(r, 800));
  live = false;
  return { visibility: document.visibilityState, ticks, io, search: location.search };
})()`;

type Probe = { visibility: string; ticks: number; io: boolean; search: string };

function findChrome(): string | null {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.GOOGLE_CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
  ].filter((c): c is string => !!c);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  const which = spawnSync('which', ['google-chrome'], { encoding: 'utf8' });
  return which.status === 0 && which.stdout.trim() ? which.stdout.trim() : null;
}

async function kill(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise(r => child.once('exit', r)), new Promise(r => setTimeout(r, 3000))]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

async function daemonStatus(): Promise<{ profiles?: Array<{ contextId: string }> } | null> {
  try {
    const res = await fetch(`${DAEMON}/status`, { headers: HEADERS, signal: AbortSignal.timeout(1000) });
    return await res.json() as { profiles?: Array<{ contextId: string }> };
  } catch {
    return null;
  }
}

type DevToolsTarget = { type: string; url: string; webSocketDebuggerUrl?: string };

/** Targets of the launched browser, via the port it wrote to its profile dir. */
async function devToolsTargets(userDataDir: string): Promise<DevToolsTarget[]> {
  const [port] = fs.readFileSync(path.join(userDataDir, 'DevToolsActivePort'), 'utf8').split('\n');
  return await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as DevToolsTarget[];
}

/** URLs of the page targets in the launched browser (proves runs landed there). */
async function launchedPageUrls(userDataDir: string): Promise<string[]> {
  return (await devToolsTargets(userDataDir)).filter(t => t.type === 'page').map(t => t.url);
}

/** Read the extension's persisted contextId through the launched Chrome's DevTools endpoint. */
async function readExtensionContextId(userDataDir: string): Promise<string | null> {
  try {
    const worker = (await devToolsTargets(userDataDir)).find(t => t.type === 'service_worker' && /^chrome-extension:\/\/[a-p]+\/dist\/background\.js$/.test(t.url));
    if (!worker?.webSocketDebuggerUrl) return null;
    const ws = new WebSocket(worker.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const reply = await new Promise<{ result?: { result?: { value?: unknown } } }>((resolve) => {
      ws.on('message', (m) => { const msg = JSON.parse(String(m)); if (msg.id === 1) resolve(msg); });
      ws.send(JSON.stringify({
        id: 1,
        method: 'Runtime.evaluate',
        params: { expression: `chrome.storage.local.get('${CONTEXT_ID_KEY}').then(r => r['${CONTEXT_ID_KEY}'] ?? null)`, awaitPromise: true, returnByValue: true },
      }));
    });
    ws.close();
    const value = reply.result?.result?.value;
    return typeof value === 'string' && value ? value : null;
  } catch {
    return null;
  }
}

async function until<T>(fn: () => Promise<T | null | undefined>, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise(r => setTimeout(r, 250));
  }
}

describe('site slot pool — real Chrome', () => {
  let server: Server | null = null;
  let daemon: ChildProcess | null = null;
  let chrome: ChildProcess | null = null;
  let userDataDir = '';
  let base = '';
  let contextId = '';
  let skipReason = '';

  beforeAll(async () => {
    if (await daemonStatus()) {
      skipReason = 'port 19825 is in use — stop the running opencli daemon first';
      return;
    }
    const chromePath = findChrome();
    if (!chromePath) {
      skipReason = 'Chrome executable not found';
      return;
    }
    server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(FIXTURE); });
    await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    daemon = spawn(process.execPath, ['--import', 'tsx/esm', path.join(ROOT, 'src/daemon.ts')], { cwd: ROOT, stdio: 'ignore' });
    await until(daemonStatus, 15_000, 'daemon');

    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-slots-chrome-'));
    const ext = path.join(ROOT, 'extension');
    chrome = spawn(chromePath, [
      ...(process.env.OPENCLI_E2E_HEADLESS === '1' ? ['--headless=new'] : []),
      `--user-data-dir=${userDataDir}`,
      `--disable-extensions-except=${ext}`,
      `--load-extension=${ext}`,
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      '--no-first-run', '--no-default-browser-check', '--disable-sync', '--no-sandbox',
      '--disable-background-networking', '--disable-component-update',
      '--window-size=1280,720',
      '--remote-debugging-port=0',
      'about:blank',
    ], { stdio: 'ignore' });
    // A developer's own Chrome extensions connect to this daemon too, so ask the
    // launched Chrome's extension for its contextId instead of guessing by order.
    try {
      contextId = await until(() => readExtensionContextId(userDataDir), 30_000, 'the test Chrome extension contextId');
    } catch {
      // Branded Google Chrome ignores --load-extension; never fall back to some other connected profile.
      skipReason = `the OpenCLI extension did not load in ${chromePath} — set CHROME_PATH to Chromium or Chrome for Testing`;
      if (process.env.CI === 'true') throw new Error(skipReason);
      return;
    }
    await until(async () => (await daemonStatus())?.profiles?.some(p => p.contextId === contextId), 45_000, 'the test Chrome extension to connect');
    process.env.OPENCLI_SITE_SLOTS = 'slots-e2e:2';
  }, 90_000);

  afterAll(async () => {
    delete process.env.OPENCLI_SITE_SLOTS;
    await kill(chrome);
    await kill(daemon);
    await new Promise<void>(r => (server ? server.close(() => r()) : r()));
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  // `foreground` opens the page in a NEW tab, which the extension always creates
  // active — a deterministic way to push the slot tab into the background.
  const probe = (site: string, opts: { siteSession?: 'persistent'; foreground?: boolean } = {}) => cli({
    site,
    name: 'probe',
    access: 'read',
    description: 'slot pool rendering probe',
    browser: true,
    strategy: Strategy.PUBLIC,
    navigateBefore: false,
    ...(opts.siteSession ? { siteSession: opts.siteSession } : {}),
    args: [{ name: 'run', positional: true, required: true, help: 'run token' }],
    func: async (page: IPage, kwargs: Record<string, unknown>) => {
      const url = `${base}/?run=${String(kwargs.run)}`;
      if (opts.foreground) await page.newTab!(url);
      else await page.goto(url);
      return [await page.evaluate(MEASURE)];
    },
  });

  const run = async (site: string, token: string, opts: { siteSession?: 'persistent'; foreground?: boolean } = {}) =>
    ((await executeCommand(probe(site, opts), { run: token }, false, { profile: contextId })) as Probe[])[0];

  // Separate processes, like real CLI invocations: the run identity is per process.
  const runInProcess = (token: string) => new Promise<{ search: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx/esm', path.join(ROOT, 'tests/e2e/fixtures/slot-probe-run.ts'), 'slots-e2e', `${base}/?run=${token}`, contextId], {
      cwd: ROOT,
      env: { ...process.env, OPENCLI_SITE_SLOTS: 'slots-e2e:2' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    child.on('exit', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`probe ${token} exited ${code}: ${err.slice(-500)}`))));
  });

  it('isolates concurrent runs: each slot run sees only its own page', async (ctx) => {
    if (skipReason) ctx.skip(skipReason);
    const [a, b] = await Promise.all([runInProcess('a'), runInProcess('b')]);
    expect([a.search, b.search]).toEqual(['?run=a', '?run=b']);
    const urls = await launchedPageUrls(userDataDir);
    expect(urls).toEqual(expect.arrayContaining([`${base}/?run=a`, `${base}/?run=b`]));
  }, 60_000);

  it('brings a warm slot tab back to the front after another session took it', async (ctx) => {
    if (skipReason) ctx.skip(skipReason);
    const slotTabActive = async () => {
      const res = await (await fetch(`${DAEMON}/command`, {
        method: 'POST',
        headers: HEADERS,
        body: JSON.stringify({ id: `t_${Math.random()}`, contextId, action: 'tabs', op: 'list', surface: 'adapter', siteSession: 'persistent', session: 'site:slots-e2e#0' }),
      })).json() as { data: Array<{ active: boolean }> };
      return res.data[0]?.active;
    };

    const warm = await run('slots-e2e', 'warm');
    expect(warm).toMatchObject({ visibility: 'visible', io: true });
    expect(warm.ticks).toBeGreaterThan(5);

    // Another session opens a new (active) tab, backgrounding the slot tab.
    await run('slots-e2e-other', 'x', { siteSession: 'persistent', foreground: true });
    expect(await slotTabActive()).toBe(false);

    const again = await run('slots-e2e', 'again');
    expect(await slotTabActive()).toBe(true);
    expect(again).toMatchObject({ visibility: 'visible', io: true, search: '?run=again' });
    expect(again.ticks).toBeGreaterThan(5);
  }, 60_000);

  // Daemon wiring, driven over its HTTP API (no page traffic).
  const post = (body: Record<string, unknown>, signal?: AbortSignal) =>
    fetch(`${DAEMON}/command`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ id: `t_${Math.random()}`, contextId, ...body }), signal });
  const slotsOf = async (site: string) =>
    ((await (await fetch(`${DAEMON}/status`, { headers: HEADERS })).json()) as { siteSlots: Array<{ key: string; slot: number; runId: string | null; waiting: number }> })
      .siteSlots.filter(s => s.key.endsWith(site));

  it('dequeues a waiter whose client disconnects, frees a slot on lease-release, and rejects a run that lost its slot', async (ctx) => {
    if (skipReason) ctx.skip(skipReason);
    const site = 'slots-e2e-wiring';
    const grant = await (await post({ action: 'slot-acquire', site, runId: 'run_1_1_hold', poolSize: 1, waitMs: 10_000 })).json();
    expect(grant).toMatchObject({ ok: true, data: { session: `site:${site}#0` } });

    const abort = new AbortController();
    const waiting = post({ action: 'slot-acquire', site, runId: 'run_1_1_wait', poolSize: 1, waitMs: 10_000 }, abort.signal).catch(() => null);
    await until(async () => (await slotsOf(site))[0]?.waiting === 1, 5000, 'the waiter to queue');
    abort.abort();
    await waiting;
    await until(async () => (await slotsOf(site))[0]?.waiting === 0, 5000, 'the waiter to leave');
    expect((await slotsOf(site))[0].runId).toBe('run_1_1_hold');

    const stale = await (await post({ action: 'exec', code: '1', session: `site:${site}#0`, surface: 'adapter', siteSession: 'persistent', runId: 'run_1_1_other' })).json();
    expect(stale).toMatchObject({ ok: false, errorCode: 'session_busy' });

    const crossed = await post({ action: 'slot-acquire', site: 'another-pool', runId: 'run_1_1_hold', poolSize: 1 });
    expect(await crossed.json()).toMatchObject({ ok: false, errorCode: 'slot_conflict' });
    const changed = await post({ action: 'slot-acquire', site, runId: 'run_new_policy', poolSize: 2 });
    expect(await changed.json()).toMatchObject({ ok: false, errorCode: 'slot_conflict' });
    const manual = await post({ action: 'exec', code: '1', session: `site:${site}#0`, surface: 'adapter' });
    expect(await manual.json()).toMatchObject({ ok: false, errorCode: 'session_busy' });
    const huge = await post({ action: 'slot-acquire', site, runId: 'run_huge', poolSize: 1e12 });
    expect(huge.status).toBe(400);

    await post({ action: 'lease-release', runId: 'run_1_1_hold' });
    expect((await slotsOf(site))[0].runId).toBeNull();
    const released = await post({ action: 'exec', code: '1', session: `site:${site}#0`, surface: 'adapter', runId: 'run_1_1_hold' });
    expect(await released.json()).toMatchObject({ ok: false, errorCode: 'session_busy' });
  }, 30_000);
});
