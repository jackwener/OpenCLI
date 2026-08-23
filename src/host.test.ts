import { afterEach, describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { OpenCliHost } from './host.js';
import { FrameReader, encodeFrame, encodeNativeFrames } from './host-protocol.js';
import { PKG_VERSION } from './version.js';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-host-'));
}

async function waitFor(pred: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error('timed out');
}

async function rpc(sockPath: string, value: unknown, timeoutMs = 3000): Promise<Record<string, unknown>> {
  const socket = net.connect(sockPath);
  const reader = new FrameReader();
  const result = new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('rpc timeout')), timeoutMs);
    socket.on('data', (chunk) => {
      try {
        for (const msg of reader.push(Buffer.from(chunk))) {
          clearTimeout(timer);
          resolve(msg as Record<string, unknown>);
        }
      } catch (err) {
        clearTimeout(timer);
        reject(err);
      }
    });
    socket.on('error', reject);
  });
  socket.write(encodeFrame(value));
  try {
    return await result;
  } finally {
    socket.end();
  }
}

describe('OpenCliHost mux', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('hello binds a unix socket and round-trips a CLI command through native stdio', async () => {
    const dir = tmpDir();
    dirs.push(dir);
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const nativeOut = new FrameReader();
    const forwarded: unknown[] = [];
    stdout.on('data', (chunk) => {
      forwarded.push(...nativeOut.push(chunk));
    });

    const host = new OpenCliHost({ io: { stdin, stdout }, runtimeDir: dir });
    const running = host.run();

    stdin.write(encodeFrame({ type: 'hello', contextId: 'work', version: '1.0.22', compatRange: '>=1.0.0' }));
    await waitFor(() => forwarded.some((m) => (m as { type?: string }).type === 'hello-ok'));
    const helloOk = forwarded.find((m) => (m as { type?: string }).type === 'hello-ok') as {
      hostVersion: string;
      contextId: string;
    };
    expect(helloOk.hostVersion).toBe(PKG_VERSION);
    expect(helloOk.contextId).toBe('work');

    const sock = path.join(dir, 'host-work.sock');
    const stateFile = path.join(dir, 'host-work.json');
    await waitFor(() => fs.existsSync(sock) && fs.existsSync(stateFile));
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    expect(state.contextId).toBe('work');
    expect(state.extensionVersion).toBe('1.0.22');
    expect(state.pid).toBe(process.pid);

    const pending = rpc(sock, { id: 'cmd_1', action: 'exec', code: '1+1' });
    await waitFor(() => forwarded.some((m) => (m as { id?: string }).id === 'cmd_1'));
    const command = forwarded.find((m) => (m as { id?: string }).id === 'cmd_1') as { action: string; code: string };
    expect(command.action).toBe('exec');
    expect(command.code).toBe('1+1');

    for (const frame of encodeNativeFrames({ id: 'cmd_1', ok: true, data: { value: 2 } })) {
      stdin.write(frame);
    }
    const result = await pending;
    expect(result).toMatchObject({ id: 'cmd_1', ok: true, data: { value: 2 } });

    stdin.end();
    await running;
    expect(fs.existsSync(sock)).toBe(false);
    expect(fs.existsSync(path.join(dir, 'host-work.json'))).toBe(false);
  });

  it('attaches a duplicate command id to the in-flight command instead of re-dispatching', async () => {
    const dir = tmpDir();
    dirs.push(dir);
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const nativeOut = new FrameReader();
    const forwarded: unknown[] = [];
    stdout.on('data', (chunk) => forwarded.push(...nativeOut.push(chunk)));
    const host = new OpenCliHost({ io: { stdin, stdout }, runtimeDir: dir });
    const running = host.run();
    stdin.write(encodeFrame({ type: 'hello', contextId: 'p1', version: '1.0.22' }));
    const sock = path.join(dir, 'host-p1.sock');
    await waitFor(() => fs.existsSync(sock));

    const first = rpc(sock, { id: 'same', action: 'navigate', url: 'https://example.com' });
    await waitFor(() => forwarded.filter((m) => (m as { id?: string }).id === 'same').length === 1);
    const second = rpc(sock, { id: 'same', action: 'navigate', url: 'https://example.com' });
    await new Promise((r) => setTimeout(r, 50));
    expect(forwarded.filter((m) => (m as { id?: string }).id === 'same')).toHaveLength(1);

    stdin.write(encodeFrame({ id: 'same', ok: true, data: { ok: true } }));
    await expect(first).resolves.toMatchObject({ id: 'same', ok: true });
    await expect(second).resolves.toMatchObject({ id: 'same', ok: true });

    stdin.end();
    await running;
  });

  it('answers host-status locally without forwarding to the extension', async () => {
    const dir = tmpDir();
    dirs.push(dir);
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const nativeOut = new FrameReader();
    const forwarded: unknown[] = [];
    stdout.on('data', (chunk) => forwarded.push(...nativeOut.push(chunk)));
    const host = new OpenCliHost({ io: { stdin, stdout }, runtimeDir: dir });
    const running = host.run();
    stdin.write(encodeFrame({ type: 'hello', contextId: 'p2', version: '1.0.22' }));
    const sock = path.join(dir, 'host-p2.sock');
    await waitFor(() => fs.existsSync(sock));
    const status = await rpc(sock, { id: 's', action: 'host-status' });
    expect(status.ok).toBe(true);
    expect(status.extensionConnected).toBe(true);
    expect(status.contextId).toBe('p2');
    expect(status.hostVersion).toBe(PKG_VERSION);
    expect(forwarded.some((m) => (m as { action?: string }).action === 'host-status')).toBe(false);
    stdin.end();
    await running;
  });
});
