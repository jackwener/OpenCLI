import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonOutput, runCli } from './helpers.js';
import { FrameReader, encodeFrame, instanceSocketPath } from '../../src/host-protocol.js';

const PKG_VERSION: string = (() => {
  const here = path.dirname(fileURLToPath(import.meta.url));
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

type FakeHost = {
  close: () => Promise<void>;
  configDir: string;
  maxInFlightExec: () => number;
};

function isPipe(sockPath: string): boolean {
  return sockPath.startsWith('\\\\.\\pipe\\');
}

async function startFakeHost(): Promise<FakeHost> {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-e2e-host-'));
  const runDir = path.join(configDir, 'run');
  fs.mkdirSync(runDir, { recursive: true });
  const sockPath = instanceSocketPath('default', process.pid, runDir);
  const statePath = path.join(runDir, 'host-default.json');

  const tabs = new Map<string, FakeTab>([
    ['tab-1', { page: 'tab-1', url: 'https://one.example/', title: 'tab-one', active: true }],
    ['tab-2', { page: 'tab-2', url: 'https://two.example/', title: 'tab-two', active: false }],
  ]);
  let nextId = 3;
  let inFlightExec = 0;
  let maxInFlightExec = 0;

  const listTabs = () => [...tabs.values()].map((tab, index) => ({ index, ...tab }));
  const tabByIndex = (index?: number) => index === undefined ? undefined : listTabs()[index];

  const reply = (socket: net.Socket, value: unknown) => {
    socket.write(encodeFrame(value));
  };

  const handle = async (body: Record<string, unknown>, socket: net.Socket): Promise<void> => {
    const id = body.id;
    if (body.action === 'host-status') {
      reply(socket, {
        id,
        ok: true,
        pid: process.pid,
        uptime: 1,
        hostVersion: PKG_VERSION,
        extensionConnected: true,
        extensionVersion: '1.0.24',
        contextId: 'default',
        profiles: [{ contextId: 'default', extensionConnected: true, extensionVersion: '1.0.24', pending: 0 }],
        pending: 0,
        memoryMB: 1,
        sock: sockPath,
      });
      return;
    }
    if (body.action === 'lease-release' || body.action === 'host-exit') {
      reply(socket, { id, ok: true });
      return;
    }

    switch (body.action) {
      case 'tabs': {
        switch (body.op) {
          case 'list':
            reply(socket, { id, ok: true, data: listTabs() });
            return;
          case 'new': {
            const page = `tab-${nextId++}`;
            const url = typeof body.url === 'string' ? body.url : 'about:blank';
            tabs.set(page, { page, url, title: page, active: true });
            reply(socket, { id, ok: true, page, data: { url } });
            return;
          }
          case 'close': {
            const targetPage = typeof body.page === 'string' ? body.page : tabByIndex(typeof body.index === 'number' ? body.index : undefined)?.page;
            if (!targetPage || !tabs.has(targetPage)) {
              reply(socket, { id, ok: false, error: 'Tab not found' });
              return;
            }
            tabs.delete(targetPage);
            reply(socket, { id, ok: true, data: { closed: targetPage } });
            return;
          }
          case 'select': {
            const targetPage = typeof body.page === 'string' ? body.page : tabByIndex(typeof body.index === 'number' ? body.index : undefined)?.page;
            if (!targetPage || !tabs.has(targetPage)) {
              reply(socket, { id, ok: false, error: 'Tab not found' });
              return;
            }
            reply(socket, { id, ok: true, page: targetPage, data: { selected: true } });
            return;
          }
          default:
            reply(socket, { id, ok: false, error: `Unknown tabs op: ${body.op}` });
            return;
        }
      }
      case 'navigate': {
        const targetPage = typeof body.page === 'string' && tabs.has(body.page) ? body.page : 'tab-1';
        const target = tabs.get(targetPage)!;
        const url = typeof body.url === 'string' ? body.url : target.url;
        target.url = url;
        target.title = url;
        reply(socket, {
          id,
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
          reply(socket, { id, ok: false, error: `Unknown page: ${targetPage}` });
          return;
        }
        inFlightExec++;
        maxInFlightExec = Math.max(maxInFlightExec, inFlightExec);
        try {
          if (String(body.code ?? '').includes('__delay')) {
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
          reply(socket, {
            id,
            ok: true,
            page: targetPage,
            data: { page: targetPage, title: target.title, url: target.url },
          });
        } finally {
          inFlightExec--;
        }
        return;
      }
      default:
        reply(socket, { id, ok: false, error: `Unknown action: ${body.action}` });
    }
  };

  if (!isPipe(sockPath)) {
    try { fs.unlinkSync(sockPath); } catch { /* first bind */ }
  }

  const server = net.createServer((socket) => {
    const reader = new FrameReader();
    socket.on('data', (chunk) => {
      try {
        for (const msg of reader.push(Buffer.from(chunk))) {
          void handle(msg as Record<string, unknown>, socket);
        }
      } catch (err) {
        reply(socket, { ok: false, error: err instanceof Error ? err.message : 'Invalid frame' });
      }
    });
    socket.on('error', () => socket.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(sockPath, () => resolve());
  });
  if (!isPipe(sockPath)) {
    try { fs.chmodSync(sockPath, 0o700); } catch { /* windows */ }
  }

  fs.writeFileSync(statePath, JSON.stringify({
    pid: process.pid,
    sock: sockPath,
    contextId: 'default',
    hostVersion: PKG_VERSION,
    extensionVersion: '1.0.24',
    extensionCompatRange: '>=2.0.0',
    startedAt: Date.now(),
  }, null, 2) + '\n');

  return {
    configDir,
    maxInFlightExec: () => maxInFlightExec,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(configDir, { recursive: true, force: true });
    },
  };
}

describe('browser tab CLI e2e', () => {
  const hosts: FakeHost[] = [];
  const cacheDirs: string[] = [];
  const browserArgs = (session: string, ...args: string[]) => ['browser', session, ...args];

  function cliEnv(host: FakeHost, extra: Record<string, string> = {}) {
    return {
      OPENCLI_CONFIG_DIR: host.configDir,
      OPENCLI_NO_LAUNCH_CHROME: '1',
      CI: '1',
      ...extra,
    };
  }

  afterEach(async () => {
    while (hosts.length > 0) {
      await hosts.pop()!.close();
    }
    while (cacheDirs.length > 0) {
      fs.rmSync(cacheDirs.pop()!, { recursive: true, force: true });
    }
  });

  it('lists, creates, and closes tabs through the built CLI', async () => {
    const host = await startFakeHost();
    hosts.push(host);
    const env = cliEnv(host);
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
    const host = await startFakeHost();
    hosts.push(host);
    const env = cliEnv(host);
    const session = 'tabs-concurrent';

    const [left, right] = await Promise.all([
      runCli(browserArgs(session, 'eval', '--tab', 'tab-1', 'window.__delay = "left"'), { timeout: 30_000, env }),
      runCli(browserArgs(session, 'eval', '--tab', 'tab-2', 'window.__delay = "right"'), { timeout: 30_000, env }),
    ]);

    expect(left.code).toBe(0);
    expect(right.code).toBe(0);

    const leftData = parseJsonOutput(left.stdout);
    const rightData = parseJsonOutput(right.stdout);

    expect(leftData).toEqual(expect.objectContaining({ page: 'tab-1', title: 'tab-one' }));
    expect(rightData).toEqual(expect.objectContaining({ page: 'tab-2', title: 'tab-two' }));
    expect(host.maxInFlightExec()).toBe(2);
  }, 30_000);

  it('keeps untargeted browser commands on the default tab after creating a new tab', async () => {
    const host = await startFakeHost();
    hosts.push(host);
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-browser-tabs-'));
    cacheDirs.push(cacheDir);
    const env = cliEnv(host, { OPENCLI_CACHE_DIR: cacheDir });
    const session = 'tabs-default-new';

    const created = await runCli(browserArgs(session, 'tab', 'new', 'https://three.example/'), { env });
    expect(created.code).toBe(0);
    expect(parseJsonOutput(created.stdout)).toEqual(expect.objectContaining({ page: 'tab-3' }));

    const untargeted = await runCli(browserArgs(session, 'eval', 'document.title'), { env });
    expect(untargeted.code).toBe(0);
    expect(parseJsonOutput(untargeted.stdout)).toEqual(expect.objectContaining({ page: 'tab-1', title: 'tab-one' }));
  }, 30_000);

  it('uses an explicitly selected tab as the default target for later untargeted commands', async () => {
    const host = await startFakeHost();
    hosts.push(host);
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-browser-tabs-'));
    cacheDirs.push(cacheDir);
    const env = cliEnv(host, { OPENCLI_CACHE_DIR: cacheDir });
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
