/**
 * opencli micro-daemon — HTTP + WebSocket bridge between CLI and Chrome Extension.
 *
 * Architecture:
 *   CLI → HTTP POST /command → daemon → WebSocket → Extension
 *   Extension → WebSocket result → daemon → HTTP response → CLI
 *
 * Security (defense-in-depth against browser-based CSRF):
 *   1. Origin check — reject HTTP/WS from non chrome-extension:// origins
 *   2. Custom header — require X-OpenCLI header (browsers can't send it
 *      without CORS preflight, which we deny)
 *   3. No CORS headers on command endpoints — only /ping is readable from the
 *      Browser Bridge extension origin so the extension can probe daemon reachability
 *   4. Body size limit — 1 MB max to prevent OOM
 *   5. WebSocket verifyClient — reject upgrade before connection is established
 *
 * Lifecycle:
 *   - Auto-spawned by opencli on first browser command
 *   - Persistent — stays alive until explicit shutdown, SIGTERM, or uninstall
 *   - Listens on localhost:19825
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { DEFAULT_DAEMON_PORT, isIgnorableDaemonPortEnv, unsupportedDaemonPortEnvMessage } from './constants.js';
import { EXIT_CODES } from './errors.js';
import { log } from './logger.js';
import { PKG_VERSION } from './version.js';
import { DEFAULT_CONTEXT_ID } from './browser/profile.js';
import { recordExtensionVersion } from './update-check.js';
import {
  PROFILE_DISCONNECTED_HINT,
  buildCommandDispatchFailure,
  buildCommandTimeoutFailure,
  buildExtensionDisconnectFailure,
  getResponseCorsHeaders,
  resolveProfileRoute,
} from './daemon-utils.js';

const PORT = DEFAULT_DAEMON_PORT;
if (!isIgnorableDaemonPortEnv(process.env.OPENCLI_DAEMON_PORT)) {
  log.error(unsupportedDaemonPortEnvMessage(process.env.OPENCLI_DAEMON_PORT));
  process.exit(EXIT_CODES.USAGE_ERROR);
}

// ─── State ───────────────────────────────────────────────────────────

type ExtensionProfileConnection = {
  contextId: string;
  ws: WebSocket;
  extensionVersion: string | null;
  extensionCompatRange: string | null;
  lastSeenAt: number;
};

const extensionProfiles = new Map<string, ExtensionProfileConnection>();
type PendingSettler = {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
};
type PendingEntry = {
  contextId: string;
  action: string;
  dispatched: boolean;
  /**
   * All HTTP requests waiting on this command id. The first settler is the
   * original request; transport retries with the same id attach here instead
   * of re-dispatching, so a retry never re-executes a command that is still
   * running.
   */
  settlers: PendingSettler[];
  timer: ReturnType<typeof setTimeout>;
};
const pending = new Map<string, PendingEntry>();

function settlePending(id: string, entry: PendingEntry, outcome: { data?: unknown; error?: Error }): void {
  clearTimeout(entry.timer);
  pending.delete(id);
  for (const settler of entry.settlers) {
    if (outcome.error) settler.reject(outcome.error);
    else settler.resolve(outcome.data);
  }
}
let commandResultUnknownCount = 0;
// Extension log ring buffer
interface LogEntry { level: string; msg: string; ts: number; }
const LOG_BUFFER_SIZE = 200;
const logBuffer: LogEntry[] = [];

class DaemonCommandFailure extends Error {
  constructor(
    message: string,
    readonly errorCode?: string,
    readonly errorHint?: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = 'DaemonCommandFailure';
  }
}

function pushLog(entry: LogEntry): void {
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
}

function activeProfiles(): ExtensionProfileConnection[] {
  return [...extensionProfiles.values()].filter((entry) => entry.ws.readyState === WebSocket.OPEN);
}

/** Stale defaults we already warned about — one log line per daemon lifetime. */
const staleDefaultWarned = new Set<string>();

function resolveExtensionConnection(contextId?: string, preferredContextId?: string): {
  connection?: ExtensionProfileConnection;
  errorCode?: 'extension_not_connected' | 'profile_required' | 'profile_disconnected';
  error?: string;
  errorHint?: string;
} {
  const route = resolveProfileRoute({
    requestedContextId: typeof contextId === 'string' ? contextId : undefined,
    preferredContextId: typeof preferredContextId === 'string' ? preferredContextId : undefined,
    connectedContextIds: activeProfiles().map((entry) => entry.contextId),
  });
  if (!route.ok) {
    return { errorCode: route.errorCode, error: route.error, ...(route.errorHint ? { errorHint: route.errorHint } : {}) };
  }
  if (route.fallbackFrom && !staleDefaultWarned.has(route.fallbackFrom)) {
    staleDefaultWarned.add(route.fallbackFrom);
    log.warn(
      `[daemon] Default profile "${route.fallbackFrom}" is not connected; ` +
      `using the only connected profile "${route.contextId}". Update the default with: opencli profile use <name>`,
    );
  }
  const connection = extensionProfiles.get(route.contextId);
  if (connection?.ws.readyState === WebSocket.OPEN) return { connection };
  // Connection raced away between arbitration and lookup.
  return {
    errorCode: 'profile_disconnected',
    error: `Browser profile "${route.contextId}" is not connected.`,
    errorHint: PROFILE_DISCONNECTED_HINT,
  };
}

function registerExtensionConnection(ws: WebSocket, rawContextId: unknown): ExtensionProfileConnection {
  const contextId = typeof rawContextId === 'string' && rawContextId.trim()
    ? rawContextId.trim()
    : DEFAULT_CONTEXT_ID;
  const previous = extensionProfiles.get(contextId);
  if (previous && previous.ws !== ws) {
    previous.ws.close();
  }
  const existing = [...extensionProfiles.entries()].find(([, entry]) => entry.ws === ws);
  if (existing && existing[0] !== contextId) extensionProfiles.delete(existing[0]);

  const current = extensionProfiles.get(contextId);
  const connection: ExtensionProfileConnection = {
    contextId,
    ws,
    extensionVersion: current?.ws === ws ? current.extensionVersion : null,
    extensionCompatRange: current?.ws === ws ? current.extensionCompatRange : null,
    lastSeenAt: Date.now(),
  };
  extensionProfiles.set(contextId, connection);
  return connection;
}

function unregisterExtensionConnection(ws: WebSocket): void {
  for (const [contextId, connection] of extensionProfiles.entries()) {
    if (connection.ws !== ws) continue;
    extensionProfiles.delete(contextId);
    for (const [id, p] of pending) {
      if (p.contextId !== contextId) continue;
      const failure = buildExtensionDisconnectFailure({
        contextId,
        action: p.action,
        dispatched: p.dispatched,
      });
      if (failure.countAsCommandResultUnknown) {
        commandResultUnknownCount++;
        log.warn(`[daemon] Command result unknown after extension disconnect (id=${id}, action=${p.action}, context=${contextId})`);
      }
      settlePending(id, p, { error: new DaemonCommandFailure(failure.message, failure.errorCode, failure.errorHint, failure.status) });
    }
  }
}

// ─── HTTP Server ─────────────────────────────────────────────────────

const MAX_BODY = 1024 * 1024; // 1 MB — commands are tiny; this prevents OOM

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) { aborted = true; req.destroy(); reject(new Error('Body too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => { if (!aborted) resolve(Buffer.concat(chunks).toString('utf-8')); });
    req.on('error', (err) => { if (!aborted) reject(err); });
  });
}

function jsonResponse(
  res: ServerResponse,
  status: number,
  data: unknown,
  extraHeaders?: Record<string, string>,
): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
  res.end(JSON.stringify(data));
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // ─── Security: Origin & custom-header check ──────────────────────
  // Block browser-based CSRF: browsers always send an Origin header on
  // cross-origin requests.  Node.js CLI fetch does NOT send Origin, so
  // legitimate CLI requests pass through.  Chrome Extension connects via
  // WebSocket (which bypasses this HTTP handler entirely).
  const origin = req.headers['origin'] as string | undefined;
  if (origin && !origin.startsWith('chrome-extension://')) {
    jsonResponse(res, 403, { ok: false, error: 'Forbidden: cross-origin request blocked' });
    return;
  }

  // CORS: do NOT send Access-Control-Allow-Origin for normal requests.
  // Only handle preflight so browsers get a definitive "no" answer.
  if (req.method === 'OPTIONS') {
    // No ACAO header → browser will block the actual request.
    res.writeHead(204);
    res.end();
    return;
  }

  const url = req.url ?? '/';
  const pathname = url.split('?')[0];

  // Health-check endpoint — no X-OpenCLI header required.
  // Used by the extension to silently probe daemon reachability before
  // attempting a WebSocket connection (avoids uncatchable ERR_CONNECTION_REFUSED).
  // Security note: this endpoint is reachable by any client that passes the
  // origin check above (chrome-extension:// or no Origin header, e.g. curl).
  // Timing side-channels can reveal daemon presence to local processes, which
  // is an accepted risk given the daemon is loopback-only and short-lived.
  if (req.method === 'GET' && pathname === '/ping') {
    jsonResponse(res, 200, { ok: true }, getResponseCorsHeaders(pathname, origin));
    return;
  }

  // Require custom header on all other HTTP requests.  Browsers cannot attach
  // custom headers in "simple" requests, and our preflight returns no
  // Access-Control-Allow-Headers, so scripted fetch() from web pages is
  // blocked even if Origin check is somehow bypassed.
  if (!req.headers['x-opencli']) {
    jsonResponse(res, 403, { ok: false, error: 'Forbidden: missing X-OpenCLI header' });
    return;
  }

  if (req.method === 'GET' && pathname === '/status') {
    const uptime = process.uptime();
    const mem = process.memoryUsage();
    const params = new URL(url, `http://localhost:${PORT}`).searchParams;
    const requestedContextId = params.get('contextId')?.trim() || undefined;
    const route = resolveExtensionConnection(requestedContextId);
    const profiles = activeProfiles().map((profile) => ({
      contextId: profile.contextId,
      extensionConnected: true,
      extensionVersion: profile.extensionVersion ?? undefined,
      extensionCompatRange: profile.extensionCompatRange ?? undefined,
      pending: [...pending.values()].filter((entry) => entry.contextId === profile.contextId).length,
      lastSeenAt: profile.lastSeenAt,
    }));
    jsonResponse(res, 200, {
      ok: true,
      pid: process.pid,
      uptime,
      daemonVersion: PKG_VERSION,
      extensionConnected: !!route.connection,
      extensionVersion: route.connection?.extensionVersion ?? undefined,
      extensionCompatRange: route.connection?.extensionCompatRange ?? undefined,
      contextId: route.connection?.contextId ?? requestedContextId,
      profileRequired: route.errorCode === 'profile_required',
      profileDisconnected: route.errorCode === 'profile_disconnected',
      profiles,
      pending: pending.size,
      commandResultUnknown: commandResultUnknownCount,
      memoryMB: Math.round(mem.rss / 1024 / 1024 * 10) / 10,
      port: PORT,
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/logs') {
    const params = new URL(url, `http://localhost:${PORT}`).searchParams;
    const level = params.get('level');
    const filtered = level
      ? logBuffer.filter(e => e.level === level)
      : logBuffer;
    jsonResponse(res, 200, { ok: true, logs: filtered });
    return;
  }

  if (req.method === 'DELETE' && pathname === '/logs') {
    logBuffer.length = 0;
    jsonResponse(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && pathname === '/shutdown') {
    jsonResponse(res, 200, { ok: true, message: 'Shutting down' });
    setTimeout(() => shutdown(), 100);
    return;
  }

  if (req.method === 'POST' && url === '/command') {
    try {
      const body = JSON.parse(await readBody(req));
      if (!body.id) {
        jsonResponse(res, 400, { ok: false, error: 'Missing command id' });
        return;
      }

      const route = resolveExtensionConnection(
        typeof body.contextId === 'string' ? body.contextId : undefined,
        typeof body.preferredContextId === 'string' ? body.preferredContextId : undefined,
      );
      if (!route.connection) {
        jsonResponse(res, route.errorCode === 'profile_required' ? 409 : 503, {
          id: body.id,
          ok: false,
          errorCode: route.errorCode,
          error: route.error,
          ...(route.errorHint ? { errorHint: route.errorHint } : {}),
        });
        return;
      }

      // Absolute deadline wins over the legacy duration field: all hops share
      // one wall clock, so remaining budget absorbs queueing/transit time.
      const timeoutMs = typeof body.deadlineAt === 'number' && body.deadlineAt > 0
        ? Math.max(1000, body.deadlineAt - Date.now())
        : (typeof body.timeout === 'number' && body.timeout > 0 ? body.timeout * 1000 : 120000);

      // A transport retry of an in-flight command attaches to it instead of
      // re-dispatching — the extension is already executing this id.
      const existing = pending.get(body.id);
      if (existing) {
        const result = await new Promise<unknown>((resolve, reject) => {
          existing.settlers.push({ resolve, reject });
        });
        jsonResponse(res, 200, result);
        return;
      }

      const result = await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          const entry = pending.get(body.id);
          if (!entry) return;
          const failure = buildCommandTimeoutFailure(entry.action, timeoutMs);
          if (failure.countAsCommandResultUnknown && entry.dispatched) {
            commandResultUnknownCount++;
            log.warn(`[daemon] Command timed out after dispatch (id=${body.id}, action=${entry.action}, timeout=${timeoutMs}ms)`);
          }
          settlePending(body.id, entry, { error: new DaemonCommandFailure(failure.message, failure.errorCode, failure.errorHint, failure.status) });
        }, timeoutMs);
        const entry: PendingEntry = {
          contextId: route.connection!.contextId,
          action: typeof body.action === 'string' ? body.action : 'unknown',
          dispatched: false,
          settlers: [{ resolve, reject }],
          timer,
        };
        pending.set(body.id, entry);
        const failBeforeDispatch = (err: unknown) => {
          if (pending.get(body.id) !== entry) return;
          const failure = buildCommandDispatchFailure(entry.contextId);
          settlePending(body.id, entry, { error: new DaemonCommandFailure(failure.message, failure.errorCode, failure.errorHint, failure.status) });
          log.warn(`[daemon] Failed to dispatch command ${body.id}: ${err instanceof Error ? err.message : String(err)}`);
        };
        try {
          route.connection!.ws.send(JSON.stringify(body), (err?: Error) => {
            if (err && !entry.dispatched) failBeforeDispatch(err);
          });
          // Once ws accepts the frame, the command may execute even if the
          // result is later lost; do not downgrade later disconnects to a
          // pre-dispatch failure just because no result/ack has arrived yet.
          entry.dispatched = true;
        } catch (err) {
          failBeforeDispatch(err);
        }
      });

      jsonResponse(res, 200, result);
    } catch (err) {
      const commandFailure = err instanceof DaemonCommandFailure ? err : null;
      jsonResponse(res, commandFailure?.status ?? (err instanceof Error && err.message.includes('timeout') ? 408 : 400), {
        ok: false,
        error: err instanceof Error ? err.message : 'Invalid request',
        ...(commandFailure?.errorCode ? { errorCode: commandFailure.errorCode } : {}),
        ...(commandFailure?.errorHint ? { errorHint: commandFailure.errorHint } : {}),
      });
    }
    return;
  }

  jsonResponse(res, 404, { error: 'Not found' });
}

// ─── WebSocket for Extension ─────────────────────────────────────────

const httpServer = createServer((req, res) => { handleRequest(req, res).catch(() => { res.writeHead(500); res.end(); }); });
const wss = new WebSocketServer({
  server: httpServer,
  path: '/ext',
  verifyClient: ({ req }: { req: IncomingMessage }) => {
    // Block browser-originated WebSocket connections.  Browsers don't
    // enforce CORS on WebSocket, so a malicious webpage could connect to
    // ws://localhost:19825/ext and impersonate the Extension.  Real Chrome
    // Extensions send origin chrome-extension://<id>.
    const origin = req.headers['origin'] as string | undefined;
    return !origin || origin.startsWith('chrome-extension://');
  },
});

wss.on('connection', (ws: WebSocket) => {
  log.info('[daemon] Extension connected');

  // ── Heartbeat: ping every 15s, close if 2 pongs missed ──
  let missedPongs = 0;
  const heartbeatInterval = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) {
      clearInterval(heartbeatInterval);
      return;
    }
    if (missedPongs >= 2) {
      log.warn('[daemon] Extension heartbeat lost, closing connection');
      clearInterval(heartbeatInterval);
      ws.terminate();
      return;
    }
    missedPongs++;
    ws.ping();
  }, 15000);

  ws.on('pong', () => {
    missedPongs = 0;
  });

  ws.on('message', (data: RawData) => {
    try {
      const msg = JSON.parse(data.toString());

      // Handle hello message from extension (version handshake)
      if (msg.type === 'hello') {
        const connection = registerExtensionConnection(ws, msg.contextId);
        connection.extensionVersion = typeof msg.version === 'string' ? msg.version : null;
        connection.extensionCompatRange = typeof msg.compatRange === 'string' ? msg.compatRange : null;
        connection.lastSeenAt = Date.now();
        if (connection.extensionVersion) recordExtensionVersion(connection.extensionVersion);
        log.info(`[daemon] Extension profile connected: ${connection.contextId}`);
        return;
      }

      // Handle log messages from extension
      if (msg.type === 'log') {
        if (msg.level === 'error') log.error(`[ext] ${msg.msg}`);
        else if (msg.level === 'warn') log.warn(`[ext] ${msg.msg}`);
        else log.info(`[ext] ${msg.msg}`);
        pushLog({ level: msg.level, msg: msg.msg, ts: msg.ts ?? Date.now() });
        return;
      }

      // Application-level keepalive from the extension — WS traffic is what
      // keeps the MV3 service worker alive; nothing to do here.
      if (msg.type === 'ping') return;

      // Handle command results
      const p = pending.get(msg.id);
      if (p) {
        settlePending(msg.id, p, { data: msg });
      }
    } catch (err) {
      // Malformed message from the extension. Surface so protocol drift /
      // version skew between daemon and extension shows up in the log
      // instead of presenting as a generic command timeout downstream.
      const sample = data.toString().slice(0, 200);
      log.warn(
        `[daemon] Ignoring malformed WS message from extension: ` +
        `${err instanceof Error ? err.message : String(err)} (first 200 chars: ${JSON.stringify(sample)})`,
      );
    }
  });

  ws.on('close', () => {
    log.info('[daemon] Extension disconnected');
    clearInterval(heartbeatInterval);
    unregisterExtensionConnection(ws);
  });

  ws.on('error', () => {
    clearInterval(heartbeatInterval);
    unregisterExtensionConnection(ws);
  });
});

// ─── Start ───────────────────────────────────────────────────────────

httpServer.listen(PORT, '127.0.0.1', () => {
  log.info(`[daemon] Listening on http://127.0.0.1:${PORT}`);
});

httpServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    log.error(`[daemon] Port ${PORT} already in use — another daemon is likely running. Exiting.`);
    process.exit(EXIT_CODES.SERVICE_UNAVAIL);
  }
  log.error(`[daemon] Server error: ${err.message}`);
  process.exit(EXIT_CODES.GENERIC_ERROR);
});

// Graceful shutdown
function shutdown(): void {
  // Reject all pending requests so the CLI gets a structured response it can
  // act on instead of a socket hang-up it must treat as result-unknown.
  // Not-yet-dispatched commands get the pre-dispatch contract (safe to resend
  // anywhere); dispatched ones get `daemon_shutting_down`, which the client
  // only resends when the extension journals ids.
  for (const [id, p] of pending) {
    const failure = p.dispatched
      ? new DaemonCommandFailure(
        'Daemon shutting down before the command completed.',
        'daemon_shutting_down',
        'The daemon is being replaced; a journaling extension replays the command result on retry.',
        503,
      )
      : (() => {
        const contract = buildCommandDispatchFailure(p.contextId);
        return new DaemonCommandFailure(contract.message, contract.errorCode, contract.errorHint, contract.status);
      })();
    settlePending(id, p, { error: failure });
  }
  pending.clear();
  for (const profile of extensionProfiles.values()) profile.ws.close();
  // Let the rejection responses flush before exiting — a synchronous
  // process.exit() would kill the queued microtasks that write them.
  httpServer.close(() => process.exit(EXIT_CODES.SUCCESS));
  setTimeout(() => {
    httpServer.closeIdleConnections?.();
    setTimeout(() => process.exit(EXIT_CODES.SUCCESS), 500).unref();
  }, 100).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
