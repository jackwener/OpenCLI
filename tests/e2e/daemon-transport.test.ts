/**
 * Daemon transport contract E2E — the REAL daemon binary driven end to end.
 *
 * Complements browser-tabs.test.ts (fake daemon + real CLI) and
 * browser-ax-chrome.test.ts (fake daemon + real extension) with the missing
 * axis: a real `dist/src/daemon.js` process, a scripted fake extension on the
 * WebSocket side, and raw HTTP on the client side. Each test pins a
 * cross-layer contract that unit tests can only cover in isolation — the
 * exact classes of bugs that historically shipped:
 *
 * - duplicate command ids attach to the pending command (no re-dispatch)
 * - the per-command deadline produces a structured 408, not a hang
 * - extension disconnect after dispatch yields command_result_unknown
 * - a stale preferred profile falls back to the only connected profile
 * - graceful shutdown flushes structured 503s instead of dropping sockets
 *
 * Requires port 19825 (the fixed bridge port); lives in the e2e-fixed-port
 * project so it never runs concurrently with other fixed-port suites.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const DAEMON_ENTRY = path.join(ROOT, 'dist', 'src', 'daemon.js');
const PORT = 19825;
const BASE = `http://127.0.0.1:${PORT}`;
const HEADERS = { 'X-OpenCLI': '1', 'Content-Type': 'application/json' };

type WireResult = {
  id?: string;
  ok: boolean;
  data?: unknown;
  error?: string;
  errorCode?: string;
  errorHint?: string;
};

/** Scripted stand-in for the Browser Bridge extension. */
class FakeExtension {
  private ws: WebSocket | null = null;
  readonly received: Array<Record<string, unknown>> = [];
  /** Per-action handler; return null to stay silent (simulate a hang). */
  onCommand: (cmd: Record<string, unknown>) => WireResult | null = (cmd) => ({
    id: String(cmd.id),
    ok: true,
    data: { echo: cmd.action },
  });

  async connect(contextId: string, version = '1.0.22'): Promise<void> {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ext`, {
      headers: { origin: 'chrome-extension://e2e-fake-extension' },
    });
    this.ws = ws;
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => {
        ws.send(JSON.stringify({ type: 'hello', contextId, version, compatRange: '>=1.0.0' }));
        resolve();
      });
      ws.once('error', reject);
    });
    ws.on('message', (raw) => {
      const cmd = JSON.parse(raw.toString()) as Record<string, unknown>;
      this.received.push(cmd);
      const result = this.onCommand(cmd);
      if (result) ws.send(JSON.stringify(result));
    });
    // Give the daemon a beat to register the hello before commands route.
    await waitFor(async () => {
      const status = await getStatus();
      return status?.extensionConnected === true || (status?.profiles ?? []).some((p: any) => p.contextId === contextId);
    }, 5_000, 'daemon did not register the fake extension');
  }

  dispatchCountFor(id: string): number {
    return this.received.filter((cmd) => cmd.id === id).length;
  }

  send(result: WireResult): void {
    this.ws?.send(JSON.stringify(result));
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }

  terminate(): void {
    this.ws?.terminate();
    this.ws = null;
  }
}

async function getStatus(): Promise<any | null> {
  try {
    const res = await fetch(`${BASE}/status`, { headers: HEADERS, signal: AbortSignal.timeout(2_000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function postCommand(body: Record<string, unknown>, timeoutMs = 15_000): Promise<{ status: number; result: WireResult }> {
  const res = await fetch(`${BASE}/command`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: res.status, result: (await res.json()) as WireResult };
}

async function waitFor(check: () => Promise<boolean> | boolean, timeoutMs: number, message: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

function isPortBusy(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port: PORT, host: '127.0.0.1' });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

let nextId = 0;
function cmdId(): string {
  return `e2e-transport-${process.pid}-${++nextId}`;
}

describe('daemon transport contracts (real daemon)', () => {
  let daemon: ChildProcess | null = null;
  let skipReason = '';

  beforeAll(async () => {
    if (await isPortBusy()) {
      skipReason = `Port ${PORT} is already in use; stop the local opencli daemon before running this suite`;
      if (process.env.CI === 'true') throw new Error(skipReason);
      return;
    }
    daemon = spawn(process.execPath, [DAEMON_ENTRY], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    daemon.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    try {
      await waitFor(async () => (await getStatus()) !== null, 10_000, 'daemon did not start');
    } catch (err) {
      throw new Error(`${err instanceof Error ? err.message : String(err)}\ndaemon stderr:\n${stderr.slice(-2_000)}`);
    }
  }, 30_000);

  afterAll(async () => {
    if (!daemon) return;
    try {
      await fetch(`${BASE}/shutdown`, { method: 'POST', headers: HEADERS, signal: AbortSignal.timeout(2_000) });
    } catch { /* daemon may already be gone */ }
    await new Promise<void>((resolve) => {
      if (!daemon || daemon.exitCode !== null) return resolve();
      daemon.once('exit', () => resolve());
      setTimeout(() => { daemon?.kill('SIGKILL'); resolve(); }, 3_000);
    });
  });

  function guard(): boolean {
    if (skipReason) {
      console.warn(`skipped — ${skipReason}`);
      return true;
    }
    return false;
  }

  it('dispatches a command to the connected extension and correlates the result', async () => {
    if (guard()) return;
    const ext = new FakeExtension();
    await ext.connect('ctx-happy');
    try {
      const id = cmdId();
      const { status, result } = await postCommand({ id, action: 'exec', code: '1 + 1', session: 's', surface: 'browser' });
      expect(status).toBe(200);
      expect(result.ok).toBe(true);
      expect(result.data).toEqual({ echo: 'exec' });
      expect(ext.dispatchCountFor(id)).toBe(1);
    } finally {
      ext.close();
    }
  });

  it('attaches a duplicate command id to the pending command instead of re-dispatching', async () => {
    if (guard()) return;
    const ext = new FakeExtension();
    let release: (() => void) | null = null;
    const held = new Promise<void>((resolve) => { release = resolve; });
    ext.onCommand = (cmd) => {
      // Answer asynchronously so the duplicate arrives while pending.
      void held.then(() => ext.send({ id: String(cmd.id), ok: true, data: 'once' }));
      return null;
    };
    await ext.connect('ctx-dup');
    try {
      const id = cmdId();
      const first = postCommand({ id, action: 'navigate', url: 'https://example.com', session: 's', surface: 'browser' });
      await waitFor(() => ext.dispatchCountFor(id) === 1, 5_000, 'command was not dispatched');
      const second = postCommand({ id, action: 'navigate', url: 'https://example.com', session: 's', surface: 'browser' });
      // The duplicate must NOT reach the extension a second time.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(ext.dispatchCountFor(id)).toBe(1);
      release!();
      const [a, b] = await Promise.all([first, second]);
      expect(a.result.ok).toBe(true);
      expect(b.result.ok).toBe(true);
      expect(a.result.data).toBe('once');
      expect(b.result.data).toBe('once');
      expect(ext.dispatchCountFor(id)).toBe(1);
    } finally {
      ext.close();
    }
  });

  it('returns a structured 408 command_result_unknown when the deadline passes with no result', async () => {
    if (guard()) return;
    const ext = new FakeExtension();
    ext.onCommand = () => null; // simulate a wedged extension
    await ext.connect('ctx-deadline');
    try {
      const { status, result } = await postCommand({
        id: cmdId(),
        action: 'exec',
        code: 'while(true){}',
        session: 's',
        surface: 'browser',
        deadlineAt: Date.now() + 1_500,
      });
      expect(status).toBe(408);
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe('command_result_unknown');
    } finally {
      ext.close();
    }
  });

  it('reports command_result_unknown when the extension dies after dispatch', async () => {
    if (guard()) return;
    const ext = new FakeExtension();
    ext.onCommand = () => null;
    await ext.connect('ctx-dropout');
    const id = cmdId();
    const inflight = postCommand({ id, action: 'navigate', url: 'https://example.com', session: 's', surface: 'browser' });
    await waitFor(() => ext.dispatchCountFor(id) === 1, 5_000, 'command was not dispatched');
    ext.terminate(); // hard drop, as if the service worker was killed
    const { status, result } = await inflight;
    expect(status).toBe(503);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('command_result_unknown');
  });

  it('serves a stale preferredContextId from the only connected profile, but fails loud for a required one', async () => {
    if (guard()) return;
    const ext = new FakeExtension();
    await ext.connect('ctx-live');
    try {
      // Preference: stale default must not veto the only live profile.
      const preferred = await postCommand({
        id: cmdId(),
        action: 'exec',
        code: '1',
        session: 's',
        surface: 'browser',
        preferredContextId: 'ctx-ghost',
      });
      expect(preferred.result.ok).toBe(true);

      // Requirement: an explicit profile fails loud when offline.
      const required = await postCommand({
        id: cmdId(),
        action: 'exec',
        code: '1',
        session: 's',
        surface: 'browser',
        contextId: 'ctx-ghost',
      });
      expect(required.result.ok).toBe(false);
      expect(required.result.errorCode).toBe('profile_disconnected');
    } finally {
      ext.close();
    }
  });

  it('flushes a structured daemon_shutting_down 503 to in-flight dispatched commands on shutdown', async () => {
    if (guard()) return;
    const ext = new FakeExtension();
    ext.onCommand = () => null;
    await ext.connect('ctx-shutdown');
    const id = cmdId();
    const inflight = postCommand({ id, action: 'navigate', url: 'https://example.com', session: 's', surface: 'browser' });
    await waitFor(() => ext.dispatchCountFor(id) === 1, 5_000, 'command was not dispatched');

    await fetch(`${BASE}/shutdown`, { method: 'POST', headers: HEADERS, signal: AbortSignal.timeout(2_000) });

    // The contract under test: a structured JSON response, not a socket hang-up.
    const { status, result } = await inflight;
    expect(status).toBe(503);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('daemon_shutting_down');

    await new Promise<void>((resolve) => {
      if (!daemon || daemon.exitCode !== null) return resolve();
      daemon.once('exit', () => resolve());
      setTimeout(resolve, 3_000);
    });
    expect(daemon?.exitCode).toBe(0);
    daemon = null; // afterAll: nothing left to stop
    ext.close();
  });
});
