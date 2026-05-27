/**
 * E2E tests for `browser eval --via-extension` flag.
 *
 * Uses a fake daemon to verify:
 *  - The CLI sends action 'exec-via-scripting' (not 'exec') when --via-extension is given
 *  - The CLI sends plain 'exec' when --via-extension is absent (no silent fallback)
 *  - --via-extension combined with --frame exits with a usage error
 *  - Results from the daemon are printed correctly
 */

import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCli } from './helpers.js';

const PKG_VERSION: string = (() => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const pkgPath = path.resolve(here, '..', '..', 'package.json');
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version;
  } catch {
    return '0.0.0';
  }
})();

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
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

type RecordedCommand = {
  action: string;
  code: string;
  frameIndex?: number;
};

type FakeDaemon = {
  port: number;
  close: () => Promise<void>;
  lastCommand: () => RecordedCommand | null;
};

async function startFakeDaemon(evalResult: unknown = 'fake-result'): Promise<FakeDaemon> {
  let lastCommand: RecordedCommand | null = null;

  const server = createServer(async (req, res) => {
    const pathname = req.url?.split('?')[0] ?? '/';

    if (req.method === 'GET' && pathname === '/status') {
      const addr = server.address();
      json(res, 200, {
        ok: true,
        pid: process.pid,
        uptime: 1,
        daemonVersion: PKG_VERSION,
        extensionConnected: true,
        extensionVersion: 'test',
        pending: 0,
        memoryMB: 1,
        port: typeof addr === 'object' && addr ? addr.port : 0,
      });
      return;
    }

    if (req.method === 'GET' && pathname === '/ping') {
      json(res, 200, { ok: true });
      return;
    }

    if (req.method !== 'POST' || pathname !== '/command') {
      json(res, 404, { ok: false, error: 'Not found' });
      return;
    }

    const body = JSON.parse(await readBody(req)) as {
      id: string;
      action: string;
      code?: string;
      frameIndex?: number;
      session?: string;
      surface?: string;
    };

    if (body.action === 'bind') {
      json(res, 200, { id: body.id, ok: true, data: { session: body.session, url: 'https://example.com', title: 'Example' } });
      return;
    }

    if (body.action === 'exec' || body.action === 'exec-via-scripting') {
      lastCommand = {
        action: body.action,
        code: body.code ?? '',
        frameIndex: body.frameIndex,
      };
      json(res, 200, { id: body.id, ok: true, page: 'page-1', data: evalResult });
      return;
    }

    json(res, 200, { id: body.id, ok: false, error: `Unhandled action: ${body.action}` });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));

  const addr = server.address();
  if (!addr || typeof addr !== 'object') throw new Error('Failed to bind fake daemon');

  return {
    port: addr.port,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve())),
    lastCommand: () => lastCommand,
  };
}

describe('browser eval --via-extension e2e', () => {
  const daemons: FakeDaemon[] = [];

  afterEach(async () => {
    while (daemons.length > 0) await daemons.pop()!.close();
  });

  it('sends exec-via-scripting action to the daemon when --via-extension is passed', async () => {
    const daemon = await startFakeDaemon('page-title');
    daemons.push(daemon);
    const env = { OPENCLI_DAEMON_PORT: String(daemon.port) };

    const result = await runCli(['browser', 'work', 'eval', 'document.title', '--via-extension'], { env });

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('page-title');
    expect(daemon.lastCommand()?.action).toBe('exec-via-scripting');
    expect(daemon.lastCommand()?.code).toContain('document.title');
  });

  it('sends plain exec action (not exec-via-scripting) when --via-extension is absent', async () => {
    const daemon = await startFakeDaemon('plain-result');
    daemons.push(daemon);
    const env = { OPENCLI_DAEMON_PORT: String(daemon.port) };

    const result = await runCli(['browser', 'work', 'eval', 'document.title'], { env });

    expect(result.code).toBe(0);
    expect(daemon.lastCommand()?.action).toBe('exec');
  });

  it('prints JSON for non-string results', async () => {
    const daemon = await startFakeDaemon({ count: 5 });
    daemons.push(daemon);
    const env = { OPENCLI_DAEMON_PORT: String(daemon.port) };

    const result = await runCli(['browser', 'work', 'eval', 'someExpr', '--via-extension'], { env });

    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ count: 5 });
    expect(daemon.lastCommand()?.action).toBe('exec-via-scripting');
  });

  it('exits with non-zero code when --via-extension and --frame are combined', async () => {
    const daemon = await startFakeDaemon();
    daemons.push(daemon);
    const env = { OPENCLI_DAEMON_PORT: String(daemon.port) };

    const result = await runCli(['browser', 'work', 'eval', 'document.title', '--via-extension', '--frame', '0'], { env });

    expect(result.code).not.toBe(0);
    expect(result.stderr + result.stdout).toMatch(/--via-extension.*--frame|--frame.*--via-extension/i);
    expect(daemon.lastCommand()).toBeNull();
  });

  it('forwards the expression unchanged to the daemon', async () => {
    const expr = 'Array.from(document.querySelectorAll(".item")).length';
    const daemon = await startFakeDaemon(42);
    daemons.push(daemon);
    const env = { OPENCLI_DAEMON_PORT: String(daemon.port) };

    await runCli(['browser', 'work', 'eval', expr, '--via-extension'], { env });

    expect(daemon.lastCommand()?.code).toContain(expr);
  });
});
