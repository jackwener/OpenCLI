import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { OpenCliHost } from '../host.js';
import { FrameReader, encodeFrame } from '../host-protocol.js';
import {
  clearDaemonRunContext,
  sendCommand,
  setDaemonRunContext,
} from './daemon-client.js';

vi.mock('./daemon-lifecycle.js', () => ({
  ensureBrowserBridgeReady: vi.fn(async () => ({
    state: 'ready',
    status: {
      ok: true,
      pid: 1,
      uptime: 1,
      hostVersion: '1.0.23',
      extensionConnected: true,
      extensionVersion: '1.0.23',
      pending: 0,
      memoryMB: 1,
    },
  })),
}));

async function waitFor(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error('timed out');
}

describe('sendCommand over the native host unix socket', () => {
  let dir: string;
  let stdin: PassThrough;
  let running: Promise<void>;
  const forwarded: unknown[] = [];

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-client-'));
    vi.stubEnv('OPENCLI_CONFIG_DIR', dir);
    stdin = new PassThrough();
    const stdout = new PassThrough();
    const nativeOut = new FrameReader();
    forwarded.length = 0;
    stdout.on('data', (chunk) => forwarded.push(...nativeOut.push(chunk)));
    const host = new OpenCliHost({ io: { stdin, stdout }, runtimeDir: path.join(dir, 'run') });
    running = host.run();
    stdin.write(encodeFrame({ type: 'hello', contextId: 'default', version: '1.0.23' }));
    await waitFor(() => fs.existsSync(path.join(dir, 'run', 'host-default.json')));

    stdout.on('data', () => {
      for (const msg of forwarded.splice(0)) {
        const rec = msg as { id?: string; action?: string; type?: string; code?: string };
        if (rec.type === 'hello-ok' || !rec.id) continue;
        stdin.write(encodeFrame({ id: rec.id, ok: true, data: { echo: rec.action, code: rec.code } }));
      }
    });
  });

  afterEach(async () => {
    setDaemonRunContext(null);
    stdin.end();
    await running.catch(() => undefined);
    fs.rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('round-trips exec through the shipped host mux', async () => {
    await expect(sendCommand('exec', { code: '1 + 1' })).resolves.toEqual({ echo: 'exec', code: '1 + 1' });
  });

  it('attaches the run context to every command as a lease heartbeat', async () => {
    setDaemonRunContext({ runId: `run_${process.pid}_1_a`, command: 'chatgpt ask', access: 'write' });
    await sendCommand('exec', { code: '1 + 1', surface: 'adapter', session: 'site:chatgpt', siteSession: 'persistent' });
    clearDaemonRunContext(`run_${process.pid}_1_a`);
  });
});
