/**
 * OpenCLI native host — mux between Chrome Native Messaging and CLI unix sockets.
 *
 * Chrome is the parent: it spawns this process via connectNative().
 * CLI processes are clients of the unix socket this host binds after hello.
 * CLI never spawns this process.
 */

import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { log } from './logger.js';
import { PKG_VERSION } from './version.js';
import { EXIT_CODES } from './errors.js';
import { recordExtensionVersion } from './update-check.js';
import {
  SessionLeaseRegistry,
  buildSessionBusyFailure,
  getSessionLeaseKey,
  isSessionLeaseCommand,
} from './session-lease.js';
import {
  buildCommandDispatchFailure,
  buildCommandTimeoutFailure,
  resolveProfileRoute,
} from './daemon-utils.js';
import {
  FrameReader,
  PAYLOAD_TOO_LARGE_CODE,
  encodeFrame,
  encodeNativeFrames,
  hostStatePath,
  instanceSocketPath,
  readHostStateFile,
  runtimeDir,
  sanitizeContextId,
  type HostState,
} from './host-protocol.js';

export type HostIo = {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
};

export type HostOptions = {
  io?: HostIo;
  runtimeDir?: string;
  now?: () => number;
  /** Injected so host-exit does not kill the test runner. */
  exit?: (code: number) => void;
};

type PendingSettler = {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
};

type PendingEntry = {
  action: string;
  dispatched: boolean;
  settlers: PendingSettler[];
  timer: ReturnType<typeof setTimeout>;
  leaseKey?: string;
  runId?: string;
};

class HostCommandFailure extends Error {
  constructor(
    message: string,
    readonly errorCode?: string,
    readonly errorHint?: string,
  ) {
    super(message);
    this.name = 'HostCommandFailure';
  }
}

export type NativeHello = {
  type: 'hello';
  contextId?: unknown;
  version?: unknown;
  compatRange?: unknown;
};

export class OpenCliHost {
  readonly startedAt = Date.now();
  contextId: string | null = null;
  extensionVersion: string | null = null;
  extensionCompatRange: string | null = null;
  private readonly pending = new Map<string, PendingEntry>();
  private readonly sessionLeases = new SessionLeaseRegistry();
  private readonly reader = new FrameReader();
  private server: net.Server | null = null;
  private sockPath: string | null = null;
  private statePath: string | null = null;
  private nativeOpen = true;
  private shuttingDown = false;
  private commandResultUnknownCount = 0;
  private readonly now: () => number;
  private readonly dir: string;
  private readonly stdout: NodeJS.WritableStream;
  private readonly exitProcess: (code: number) => void;

  constructor(private readonly opts: HostOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.dir = opts.runtimeDir ?? runtimeDir();
    this.stdout = opts.io?.stdout ?? process.stdout;
    this.exitProcess = opts.exit ?? ((code) => process.exit(code));
  }

  async run(io: HostIo = this.opts.io ?? { stdin: process.stdin, stdout: process.stdout }): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const onData = (chunk: Buffer | string) => {
        try {
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          for (const msg of this.reader.push(buf)) this.onNativeMessage(msg);
        } catch (err) {
          reject(err);
        }
      };
      const onEnd = () => {
        this.shutdown('native-stdin-closed');
        resolve();
      };
      io.stdin.on('data', onData);
      io.stdin.on('end', onEnd);
      io.stdin.on('error', () => {
        this.shutdown('native-stdin-error');
        resolve();
      });
      if (typeof (io.stdin as NodeJS.ReadStream).resume === 'function') {
        (io.stdin as NodeJS.ReadStream).resume();
      }
    });
  }

  onNativeMessage(msg: unknown): void {
    if (!msg || typeof msg !== 'object') return;
    const rec = msg as Record<string, unknown>;
    if (rec.type === 'hello') {
      this.handleHello(rec as NativeHello);
      return;
    }
    if (rec.type === 'log') {
      const text = typeof rec.msg === 'string' ? rec.msg : '';
      if (rec.level === 'error') log.error(`[ext] ${text}`);
      else if (rec.level === 'warn') log.warn(`[ext] ${text}`);
      else log.info(`[ext] ${text}`);
      return;
    }
    if (rec.type === 'ping') return;
    const id = rec.id;
    if (typeof id !== 'string') return;
    const entry = this.pending.get(id);
    if (entry) this.settlePending(id, entry, { data: rec });
  }

  private handleHello(msg: NativeHello): void {
    const contextId = typeof msg.contextId === 'string' && msg.contextId.trim()
      ? msg.contextId.trim()
      : 'default';
    this.contextId = contextId;
    this.extensionVersion = typeof msg.version === 'string' ? msg.version : null;
    this.extensionCompatRange = typeof msg.compatRange === 'string' ? msg.compatRange : null;
    if (this.extensionVersion) recordExtensionVersion(this.extensionVersion);
    this.writeNative({ type: 'hello-ok', hostVersion: PKG_VERSION, contextId });
    void this.bindSocket(contextId).catch((err) => {
      log.error(`[host] Failed to bind socket: ${err instanceof Error ? err.message : String(err)}`);
      this.shutdown('bind-failed');
    });
  }

  private async bindSocket(contextId: string): Promise<void> {
    if (this.server) return;
    fs.mkdirSync(this.dir, { recursive: true });
    this.sockPath = instanceSocketPath(contextId, process.pid, this.dir);
    this.statePath = this.opts.runtimeDir
      ? path.join(this.dir, `host-${sanitizeContextId(contextId)}.json`)
      : hostStatePath(contextId);

    if (!this.sockPath.startsWith('\\\\.\\pipe\\')) {
      try { fs.unlinkSync(this.sockPath); } catch { /* first bind */ }
    }

    this.server = net.createServer((socket) => this.onCliConnection(socket));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.sockPath!, () => resolve());
    });
    if (!this.sockPath.startsWith('\\\\.\\pipe\\')) {
      try { fs.chmodSync(this.sockPath, 0o700); } catch { /* windows */ }
    }
    this.writeState();
    log.info(`[host] Listening on ${this.sockPath} (profile ${contextId})`);
  }

  private writeState(): void {
    if (!this.statePath || !this.sockPath || !this.contextId) return;
    const state: HostState = {
      pid: process.pid,
      sock: this.sockPath,
      contextId: this.contextId,
      hostVersion: PKG_VERSION,
      extensionVersion: this.extensionVersion,
      extensionCompatRange: this.extensionCompatRange,
      startedAt: this.startedAt,
    };
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    fs.writeFileSync(this.statePath, JSON.stringify(state, null, 2) + '\n');
  }

  private onCliConnection(socket: net.Socket): void {
    const reader = new FrameReader();
    socket.on('data', (chunk) => {
      try {
        for (const msg of reader.push(Buffer.from(chunk))) {
          void this.handleCliMessage(msg, socket);
        }
      } catch (err) {
        this.writeSocket(socket, {
          ok: false,
          error: err instanceof Error ? err.message : 'Invalid frame',
        });
      }
    });
    socket.on('error', () => socket.destroy());
  }

  private async handleCliMessage(msg: unknown, socket: net.Socket): Promise<void> {
    if (!msg || typeof msg !== 'object') {
      this.writeSocket(socket, { ok: false, error: 'Invalid command' });
      return;
    }
    const body = msg as Record<string, unknown>;
    if (body.action === 'host-status') {
      this.writeSocket(socket, this.statusPayload(body.id));
      return;
    }
    if (body.action === 'lease-release') {
      if (typeof body.runId === 'string') this.sessionLeases.releaseByRunId(body.runId);
      this.writeSocket(socket, { id: body.id, ok: true });
      return;
    }
    if (body.action === 'host-exit') {
      this.writeSocket(socket, { id: body.id, ok: true });
      setImmediate(() => {
        this.shutdown('host-exit');
        this.exitProcess(EXIT_CODES.SUCCESS);
      });
      return;
    }
    try {
      const result = await this.dispatchCommand(body);
      this.writeSocket(socket, result);
    } catch (err) {
      const failure = err instanceof HostCommandFailure ? err : null;
      this.writeSocket(socket, {
        id: body.id,
        ok: false,
        error: err instanceof Error ? err.message : 'Invalid request',
        ...(failure?.errorCode ? { errorCode: failure.errorCode } : {}),
        ...(failure?.errorHint ? { errorHint: failure.errorHint } : {}),
      });
    }
  }

  async dispatchCommand(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (typeof body.id !== 'string' || !body.id) {
      throw new HostCommandFailure('Missing command id');
    }
    if (!this.nativeOpen || !this.contextId) {
      throw new HostCommandFailure(
        'Extension not connected. Please install the opencli Browser Bridge extension.',
        'extension_not_connected',
      );
    }

    const route = resolveProfileRoute({
      requestedContextId: typeof body.contextId === 'string' ? body.contextId : undefined,
      preferredContextId: typeof body.preferredContextId === 'string' ? body.preferredContextId : undefined,
      connectedContextIds: [this.contextId],
    });
    if (!route.ok) {
      throw new HostCommandFailure(route.error, route.errorCode, route.errorHint);
    }

    let leaseKey: string | undefined;
    let leaseRunId: string | undefined;
    if (isSessionLeaseCommand(body)) {
      const now = this.now();
      const key = getSessionLeaseKey(this.contextId, body.surface, body.session);
      const outcome = this.sessionLeases.touch(key, {
        runId: body.runId,
        command: typeof body.command === 'string' && body.command ? body.command : String(body.action),
        now,
        hasPendingWork: (runId) => this.runHasPendingWork(runId),
      });
      if (!outcome.granted) {
        const failure = buildSessionBusyFailure(body.session, outcome.holder, now);
        throw new HostCommandFailure(failure.message, failure.errorCode, failure.errorHint);
      }
      leaseKey = key;
      leaseRunId = body.runId;
    }

    const timeoutMs = typeof body.deadlineAt === 'number' && body.deadlineAt > 0
      ? Math.max(1000, body.deadlineAt - this.now())
      : (typeof body.timeout === 'number' && body.timeout > 0 ? body.timeout * 1000 : 120000);

    const existing = this.pending.get(body.id);
    if (existing) {
      return await new Promise<Record<string, unknown>>((resolve, reject) => {
        existing.settlers.push({
          resolve: (data) => resolve(data as Record<string, unknown>),
          reject,
        });
      });
    }

    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        const entry = this.pending.get(body.id as string);
        if (!entry) return;
        const failure = buildCommandTimeoutFailure(entry.action, timeoutMs);
        if (failure.countAsCommandResultUnknown && entry.dispatched) this.commandResultUnknownCount++;
        this.settlePending(body.id as string, entry, {
          error: new HostCommandFailure(failure.message, failure.errorCode, failure.errorHint),
        });
      }, timeoutMs);
      const entry: PendingEntry = {
        action: typeof body.action === 'string' ? body.action : 'unknown',
        dispatched: false,
        settlers: [{
          resolve: (data) => resolve(data as Record<string, unknown>),
          reject,
        }],
        timer,
        ...(leaseKey && leaseRunId ? { leaseKey, runId: leaseRunId } : {}),
      };
      this.pending.set(body.id as string, entry);
      try {
        this.writeNative(body);
        entry.dispatched = true;
      } catch (err) {
        const code = err && typeof err === 'object' ? (err as { code?: unknown }).code : undefined;
        const failure = code === PAYLOAD_TOO_LARGE_CODE
          ? {
            message: err instanceof Error ? err.message : 'Native payload exceeds Chrome 1MiB cap',
            errorCode: PAYLOAD_TOO_LARGE_CODE,
            errorHint: 'Reduce the command payload (screenshot size, captured body, or eval result).',
          }
          : buildCommandDispatchFailure(this.contextId ?? 'default');
        this.settlePending(body.id as string, entry, {
          error: new HostCommandFailure(failure.message, failure.errorCode, failure.errorHint),
        });
        log.warn(`[host] Failed to dispatch command ${body.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
  }

  statusPayload(id?: unknown): Record<string, unknown> {
    const mem = process.memoryUsage();
    return {
      id,
      ok: true,
      pid: process.pid,
      uptime: (this.now() - this.startedAt) / 1000,
      hostVersion: PKG_VERSION,
      extensionConnected: this.nativeOpen && !!this.contextId,
      extensionVersion: this.extensionVersion ?? undefined,
      extensionCompatRange: this.extensionCompatRange ?? undefined,
      contextId: this.contextId ?? undefined,
      profiles: this.contextId ? [{
        contextId: this.contextId,
        extensionConnected: true,
        extensionVersion: this.extensionVersion ?? undefined,
        extensionCompatRange: this.extensionCompatRange ?? undefined,
        pending: this.pending.size,
        lastSeenAt: this.now(),
      }] : [],
      pending: this.pending.size,
      sessionLeases: this.sessionLeases.list(this.now(), (runId) => this.runHasPendingWork(runId)),
      commandResultUnknown: this.commandResultUnknownCount,
      memoryMB: Math.round(mem.rss / 1024 / 1024 * 10) / 10,
      sock: this.sockPath ?? undefined,
    };
  }

  shutdown(reason: string): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.nativeOpen = false;
    log.info(`[host] Shutting down (${reason})`);
    for (const [id, entry] of this.pending) {
      const failure = entry.dispatched
        ? new HostCommandFailure(
          'Host shutting down before the command completed.',
          'host_shutting_down',
          'Chrome replaced the native host; a journaling extension replays the command result on retry.',
        )
        : (() => {
          const contract = buildCommandDispatchFailure(this.contextId ?? 'default');
          return new HostCommandFailure(contract.message, contract.errorCode, contract.errorHint);
        })();
      this.settlePending(id, entry, { error: failure });
    }
    this.pending.clear();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.unlinkStateIfOwned();
  }

  /**
   * A replacement host may already have overwritten host-*.json. Only unlink
   * if pid + startedAt still match this process.
   */
  private unlinkStateIfOwned(): void {
    if (!this.statePath) return;
    const state = readHostStateFile(this.statePath);
    if (!state || state.pid !== process.pid || state.startedAt !== this.startedAt) return;
    try { fs.unlinkSync(this.statePath); } catch { /* already gone */ }
  }

  private writeNative(value: unknown): void {
    if (!this.nativeOpen) throw new Error('native port closed');
    for (const frame of encodeNativeFrames(value)) {
      this.stdout.write(frame);
    }
  }

  private writeSocket(socket: net.Socket, value: unknown): void {
    socket.write(encodeFrame(value));
  }

  private runHasPendingWork(runId: string): boolean {
    for (const entry of this.pending.values()) {
      if (entry.runId === runId) return true;
    }
    return false;
  }

  private settlePending(id: string, entry: PendingEntry, outcome: { data?: unknown; error?: Error }): void {
    clearTimeout(entry.timer);
    this.pending.delete(id);
    if (entry.leaseKey && entry.runId) this.sessionLeases.heartbeat(entry.leaseKey, entry.runId, this.now());
    for (const settler of entry.settlers) {
      if (outcome.error) settler.reject(outcome.error);
      else settler.resolve(outcome.data);
    }
  }
}

export async function runNativeHost(opts: HostOptions = {}): Promise<void> {
  const host = new OpenCliHost(opts);
  const io = opts.io ?? { stdin: process.stdin, stdout: process.stdout };
  const stop = (signal: string) => {
    host.shutdown(signal);
    process.exit(EXIT_CODES.SUCCESS);
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  await host.run(io);
}
