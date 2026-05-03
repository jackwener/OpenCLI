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
import { DEFAULT_DAEMON_PORT } from './constants.js';
import { EXIT_CODES } from './errors.js';
import { log } from './logger.js';
import { PKG_VERSION } from './version.js';
import { DEFAULT_CONTEXT_ID } from './browser/profile.js';
import { recordExtensionVersion } from './update-check.js';

const PORT = parseInt(process.env.OPENCLI_DAEMON_PORT ?? String(DEFAULT_DAEMON_PORT), 10);

// ─── State ───────────────────────────────────────────────────────────

type ExtensionProfileConnection = {
  contextId: string;
  ws: WebSocket;
  extensionVersion: string | null;
  extensionCompatRange: string | null;
  lastSeenAt: number;
};

const extensionProfiles = new Map<string, ExtensionProfileConnection>();
const pending = new Map<string, {
  contextId: string;
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>();
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

function activeProfiles(): ExtensionProfileConnection[] {
  return [...extensionProfiles.values()].filter((entry) => entry.ws.readyState === WebSocket.OPEN);
}

function resolveExtensionConnection(contextId?: string): {
  connection?: ExtensionProfileConnection;
  errorCode?: 'extension_not_connected' | 'profile_required' | 'profile_disconnected';
  error?: string;
  errorHint?: string;
} {
  const requestedContextId = typeof contextId === 'string' && contextId.trim() ? contextId.trim() : undefined;
  if (requestedContextId) {
    const connection = extensionProfiles.get(requestedContextId);
    if (connection?.ws.readyState === WebSocket.OPEN) return { connection };
    return {
      errorCode: 'profile_disconnected',
      error: `Browser profile "${requestedContextId}" is not connected.`,
      errorHint: 'Open that Chrome profile and make sure the OpenCLI extension is enabled, or choose another profile with opencli profile use <name>.',
    };
  }

  const connected = activeProfiles();
  if (connected.length === 1) return { connection: connected[0] };
  if (connected.length > 1) {
    return {
      errorCode: 'profile_required',
      error: 'Multiple Browser Bridge profiles are connected; choose one with --profile.',
      errorHint: 'Run opencli profile list, then use opencli --profile <name> ... or opencli profile use <name>.',
    };
  }
  return {
    errorCode: 'extension_not_connected',
    error: 'Extension not connected. Please install the opencli Browser Bridge extension.',
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
      clearTimeout(p.timer);
      p.reject(new DaemonCommandFailure(
        `Browser profile "${contextId}" disconnected`,
        'profile_disconnected',
        'Open that Chrome profile and make sure the OpenCLI extension is enabled, or choose another profile with opencli profile use <name>.',
        503,
      ));
      pending.delete(id);
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

export function getResponseCorsHeaders(pathname: string, origin?: string): Record<string, string> | undefined {
  if (pathname !== '/ping') return undefined;
  if (!origin || !origin.startsWith('chrome-extension://')) return undefined;
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
  };
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
      memoryMB: Math.round(mem.rss / 1024 / 1024 * 10) / 10,
      port: PORT,
    });
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

      const route = resolveExtensionConnection(typeof body.contextId === 'string' ? body.contextId : undefined);
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

      const timeoutMs = typeof body.timeout === 'number' && body.timeout > 0
        ? body.timeout * 1000
        : 120000;
      if (pending.has(body.id)) {
        jsonResponse(res, 409, {
          id: body.id,
          ok: false,
          error: 'Duplicate command id already pending; retry',
        });
        return;
      }
      const result = await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(body.id);
          reject(new Error(`Command timeout (${timeoutMs / 1000}s)`));
        }, timeoutMs);
        pending.set(body.id, { contextId: route.connection!.contextId, resolve, reject, timer });
        route.connection!.ws.send(JSON.stringify(body));
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

      // Handle command results
      const p = pending.get(msg.id);
      if (p) {
        clearTimeout(p.timer);
        pending.delete(msg.id);
        p.resolve(msg);
      }
    } catch {
      // Ignore malformed messages
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
  // Reject all pending requests so CLI doesn't hang
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.reject(new Error('Daemon shutting down'));
  }
  pending.clear();
  for (const profile of extensionProfiles.values()) profile.ws.close();
  httpServer.close();
  process.exit(EXIT_CODES.SUCCESS);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
