import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonOutput, runCli } from './helpers.js';

// Match the running CLI's package version so BrowserBridge does not classify
// this fake daemon as stale (PR #1399 auto-restarts daemons whose
// daemonVersion does not match PKG_VERSION; the fake daemon does not implement
// /shutdown, so a mismatch makes every test exit with code 1).
const PKG_VERSION: string = (() => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // tests/e2e -> repo root: ../..
  const pkgPath = path.resolve(here, '..', '..', 'package.json');
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version;
  } catch {
    return '0.0.0';
  }
})();

type FakeTab = {
  page: string;
  url: string;
  title: string;
  active: boolean;
};

type FakeDaemon = {
  port: number;
  close: () => Promise<void>;
  maxInFlightExec: () => number;
};

async function readBody(req: IncomingMessage): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function startFakeDaemon(): Promise<FakeDaemon> {
  const tabs = new Map<string, FakeTab>([
    ['tab-1', { page: 'tab-1', url: 'https://one.example/', title: 'tab-one', active: true }],
    ['tab-2', { page: 'tab-2', url: 'https://two.example/', title: 'tab-two', active: false }],
  ]);
  let nextId = 3;
  let inFlightExec = 0;
  let maxInFlightExec = 0;

  const server = createServer(async (req, res) => {
    const pathname = req.url?.split('?')[0] ?? '/';

    if (req.method === 'GET' && pathname === '/status') {
      const port = typeof server.address() === 'object' && server.address() ? server.address().port : 0;
      json(res, 200, {
        ok: true,
        pid: process.pid,
        uptime: 1,
        daemonVersion: PKG_VERSION,
        extensionConnected: true,
        extensionVersion: 'test',
        pending: 0,
        memoryMB: 1,
        port,
      });
      return;
    }

    if (req.method !== 'POST' || pathname !== '/command') {
      json(res, 404, { ok: false, error: 'Not found' });
      return;
    }

    const body = JSON.parse(await readBody(req)) as {
      id: string;
      action: string;
      op?: string;
      page?: string;
      index?: number;
      url?: string;
      code?: string;
    };

    const listTabs = () => [...tabs.values()].map((tab, index) => ({ index, ...tab }));
    const tabByIndex = (index?: number) => index === undefined ? undefined : listTabs()[index];

    switch (body.action) {
      case 'tabs': {
        switch (body.op) {
          case 'list':
            json(res, 200, { id: body.id, ok: true, data: listTabs() });
            return;
          case 'new': {
            const page = `tab-${nextId++}`;
            const url = body.url ?? 'about:blank';
            tabs.set(page, {
              page,
              url,
              title: page,
              active: true,
            });
            json(res, 200, { id: body.id, ok: true, page, data: { url } });
            return;
          }
          case 'close': {
            const targetPage = typeof body.page === 'string' ? body.page : tabByIndex(body.index)?.page;
            if (!targetPage || !tabs.has(targetPage)) {
              json(res, 200, { id: body.id, ok: false, error: 'Tab not found' });
              return;
            }
            tabs.delete(targetPage);
            json(res, 200, { id: body.id, ok: true, data: { closed: targetPage } });
            return;
          }
          case 'select': {
            const targetPage = typeof body.page === 'string' ? body.page : tabByIndex(body.index)?.page;
            if (!targetPage || !tabs.has(targetPage)) {
              json(res, 200, { id: body.id, ok: false, error: 'Tab not found' });
              return;
            }
            json(res, 200, { id: body.id, ok: true, page: targetPage, data: { selected: true } });
            return;
          }
          default:
            json(res, 200, { id: body.id, ok: false, error: `Unknown tabs op: ${body.op}` });
            return;
        }
      }
      case 'navigate': {
        const targetPage = typeof body.page === 'string' && tabs.has(body.page) ? body.page : 'tab-1';
        const target = tabs.get(targetPage)!;
        const url = body.url ?? target.url;
        target.url = url;
        target.title = url;
        json(res, 200, {
          id: body.id,
          ok: true,
          page: targetPage,
          data: { title: target.title, url: target.url, timedOut: false },
        });
        return;
      }
      case 'exec': {
        const targetPage = typeof body.page === 'string' ? body.page : 'tab-1';
        const target = tabs.get(targetPage);
        if (!target) {
          json(res, 200, { id: body.id, ok: false, error: `Unknown page: ${targetPage}` });
          return;
        }

        inFlightExec++;
        maxInFlightExec = Math.max(maxInFlightExec, inFlightExec);
        try {
          if ((body.code ?? '').includes('__delay')) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
          json(res, 200, {
            id: body.id,
            ok: true,
            page: targetPage,
            data: {
              page: targetPage,
              title: target.title,
              url: target.url,
            },
          });
        } finally {
          inFlightExec--;
        }
        return;
      }
      default:
        json(res, 200, { id: body.id, ok: false, error: `Unknown action: ${body.action}` });
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address !== 'object') {
    throw new Error('Failed to bind fake daemon port');
  }

  return {
    port: address.port,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => err ? reject(err) : resolve());
      });
    },
    maxInFlightExec: () => maxInFlightExec,
  };
}

describe('browser tab CLI e2e', () => {
  const daemons: FakeDaemon[] = [];
  const cacheDirs: string[] = [];
  const browserArgs = (session: string, ...args: string[]) => ['browser', session, ...args];

  afterEach(async () => {
    while (daemons.length > 0) {
      await daemons.pop()!.close();
    }
    while (cacheDirs.length > 0) {
      fs.rmSync(cacheDirs.pop()!, { recursive: true, force: true });
    }
  });

  it('lists, creates, and closes tabs through the built CLI', async () => {
    const daemon = await startFakeDaemon();
    daemons.push(daemon);
    const env = { OPENCLI_DAEMON_PORT: String(daemon.port) };
    const session = 'tabs-basic';

    const listed = await runCli(browserArgs(session, 'tab', 'list'), { env });
    expect(listed.code).toBe(0);
    const listData = parseJsonOutput(listed.stdout);
    expect(listData).toEqual(expect.arrayContaining([
      expect.objectContaining({ page: 'tab-1', title: 'tab-one' }),
      expect.objectContaining({ page: 'tab-2', title: 'tab-two' }),
    ]));

    const created = await runCli(browserArgs(session, 'tab', 'new', 'https://three.example/'), { env });
    expect(created.code).toBe(0);
    const createdData = parseJsonOutput(created.stdout);
    expect(createdData).toEqual(expect.objectContaining({
      page: 'tab-3',
      url: 'https://three.example/',
    }));

    const closed = await runCli(browserArgs(session, 'tab', 'close', 'tab-3'), { env });
    expect(closed.code).toBe(0);
    const closedData = parseJsonOutput(closed.stdout);
    expect(closedData).toEqual({ closed: 'tab-3' });

    const relisted = await runCli(browserArgs(session, 'tab', 'list'), { env });
    expect(relisted.code).toBe(0);
    const relistedData = parseJsonOutput(relisted.stdout);
    expect(relistedData).toHaveLength(2);
    expect(relistedData.some((tab: { page: string }) => tab.page === 'tab-3')).toBe(false);
  }, 30_000);

  it('routes concurrent browser commands to their requested tabs', async () => {
    const daemon = await startFakeDaemon();
    daemons.push(daemon);
    const env = { OPENCLI_DAEMON_PORT: String(daemon.port) };
    const session = 'tabs-concurrent';

    const [left, right] = await Promise.all([
      runCli(browserArgs(session, 'eval', '--tab', 'tab-1', 'window.__delay = "left"'), { env, timeout: 30_000 }),
      runCli(browserArgs(session, 'eval', '--tab', 'tab-2', 'window.__delay = "right"'), { env, timeout: 30_000 }),
    ]);

    expect(left.code).toBe(0);
    expect(right.code).toBe(0);

    const leftData = parseJsonOutput(left.stdout);
    const rightData = parseJsonOutput(right.stdout);

    expect(leftData).toEqual(expect.objectContaining({ page: 'tab-1', title: 'tab-one' }));
    expect(rightData).toEqual(expect.objectContaining({ page: 'tab-2', title: 'tab-two' }));
    expect(daemon.maxInFlightExec()).toBe(2);
  }, 30_000);

  it('keeps untargeted browser commands on the default tab after creating a new tab', async () => {
    const daemon = await startFakeDaemon();
    daemons.push(daemon);
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-browser-tabs-'));
    cacheDirs.push(cacheDir);
    const env = {
      OPENCLI_DAEMON_PORT: String(daemon.port),
      OPENCLI_CACHE_DIR: cacheDir,
    };
    const session = 'tabs-default-new';

    const created = await runCli(browserArgs(session, 'tab', 'new', 'https://three.example/'), { env });
    expect(created.code).toBe(0);
    expect(parseJsonOutput(created.stdout)).toEqual(expect.objectContaining({ page: 'tab-3' }));

    const untargeted = await runCli(browserArgs(session, 'eval', 'document.title'), { env });
    expect(untargeted.code).toBe(0);
    expect(parseJsonOutput(untargeted.stdout)).toEqual(expect.objectContaining({ page: 'tab-1', title: 'tab-one' }));
  }, 30_000);

  it('uses an explicitly selected tab as the default target for later untargeted commands', async () => {
    const daemon = await startFakeDaemon();
    daemons.push(daemon);
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-browser-tabs-'));
    cacheDirs.push(cacheDir);
    const env = {
      OPENCLI_DAEMON_PORT: String(daemon.port),
      OPENCLI_CACHE_DIR: cacheDir,
    };
    const session = 'tabs-selected-default';

    const selected = await runCli(browserArgs(session, 'tab', 'select', 'tab-2'), { env });
    expect(selected.code).toBe(0);
    expect(parseJsonOutput(selected.stdout)).toEqual({ selected: 'tab-2' });

    const untargeted = await runCli(browserArgs(session, 'eval', 'document.title'), { env });
    expect(untargeted.code).toBe(0);
    expect(parseJsonOutput(untargeted.stdout)).toEqual(expect.objectContaining({ page: 'tab-2', title: 'tab-two' }));

    const closed = await runCli(browserArgs(session, 'tab', 'close', 'tab-2'), { env });
    expect(closed.code).toBe(0);
    expect(parseJsonOutput(closed.stdout)).toEqual({ closed: 'tab-2' });

    const fallback = await runCli(browserArgs(session, 'eval', 'document.title'), { env });
    expect(fallback.code).toBe(0);
    expect(parseJsonOutput(fallback.stdout)).toEqual(expect.objectContaining({ page: 'tab-1', title: 'tab-one' }));
  }, 30_000);
});
