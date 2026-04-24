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
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { DEFAULT_DAEMON_PORT } from './constants.js';
import { EXIT_CODES } from './errors.js';
import { log } from './logger.js';
import { PKG_VERSION } from './version.js';
import { parseHello, resolveRoute, type ProfileSummary } from './daemon-routing.js';

const PORT = parseInt(process.env.OPENCLI_DAEMON_PORT ?? String(DEFAULT_DAEMON_PORT), 10);

// How long an unidentified WebSocket is allowed to sit before we close it.
// Legitimate extensions send hello immediately after ws.onopen.
const HELLO_TIMEOUT_MS = 5000;

// ─── State ───────────────────────────────────────────────────────────
// One Map entry per connected Chrome profile. Keyed by profileId so
// disconnects/reconnects of one profile never touch another profile's
// pending work. `pending` stays keyed by command id (globally unique)
// but each entry carries its owner profileId so disconnect can reject
// only the right subset.

interface ExtensionConnection {
  ws: WebSocket;
  profileId: string;
  profileLabel: string;
  version: string | null;
  compatRange: string | null;
  heartbeatInterval: ReturnType<typeof setInterval>;
}

const extensions = new Map<string, ExtensionConnection>();

/** WebSockets that have connected but not yet sent hello. Auto-close after HELLO_TIMEOUT_MS. */
const pendingHandshakes = new Map<WebSocket, ReturnType<typeof setTimeout>>();

const pending = new Map<string, {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  profileId: string;
}>();

function getConnectedProfiles(): ProfileSummary[] {
  return [...extensions.values()].map((c) => ({
    profileId: c.profileId,
    profileLabel: c.profileLabel,
  }));
}

function rejectPendingFor(profileId: string, reason: string): void {
  for (const [id, p] of pending) {
    if (p.profileId !== profileId) continue;
    clearTimeout(p.timer);
    pending.delete(id);
    p.reject(new Error(reason));
  }
}
// Extension log ring buffer
interface LogEntry { level: string; msg: string; ts: number; }
const LOG_BUFFER_SIZE = 200;
const logBuffer: LogEntry[] = [];

function pushLog(entry: LogEntry): void {
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
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
    const profiles = [...extensions.values()].map((c) => ({
      profileId: c.profileId,
      profileLabel: c.profileLabel,
      version: c.version,
      compatRange: c.compatRange,
    }));
    // Pick a representative profile for legacy single-profile fields so older
    // CLIs (that predate the multi-profile response shape) keep working.
    const first = profiles[0];
    jsonResponse(res, 200, {
      ok: true,
      pid: process.pid,
      uptime,
      daemonVersion: PKG_VERSION,
      extensionConnected: profiles.length > 0,
      extensionVersion: first?.version ?? null,
      extensionCompatRange: first?.compatRange ?? null,
      profiles,
      pending: pending.size,
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

      // `profile` is optional; CLI sets it from --profile / OPENCLI_PROFILE /
      // ~/.opencli/config.json. resolveRoute() enforces the routing rules.
      const requestedProfile = typeof body.profile === 'string' && body.profile
        ? body.profile
        : undefined;
      const route = resolveRoute(requestedProfile, getConnectedProfiles());
      if (!route.ok) {
        jsonResponse(res, route.status, {
          id: body.id,
          ok: false,
          error: route.error,
          ...(route.connected ? { connected: route.connected } : {}),
        });
        return;
      }
      const conn = extensions.get(route.profileId);
      if (!conn || conn.ws.readyState !== WebSocket.OPEN) {
        // Race: routed profile disconnected between resolveRoute() and here.
        jsonResponse(res, 503, {
          id: body.id,
          ok: false,
          error: 'Extension disconnected during command routing',
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
      // Strip the `profile` routing hint — the extension side doesn't need it.
      const { profile: _p, ...forwarded } = body;
      const result = await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(body.id);
          reject(new Error(`Command timeout (${timeoutMs / 1000}s)`));
        }, timeoutMs);
        pending.set(body.id, { resolve, reject, timer, profileId: route.profileId });
        conn.ws.send(JSON.stringify(forwarded));
      });

      jsonResponse(res, 200, result);
    } catch (err) {
      jsonResponse(res, err instanceof Error && err.message.includes('timeout') ? 408 : 400, {
        ok: false,
        error: err instanceof Error ? err.message : 'Invalid request',
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
  log.info('[daemon] Extension connected (awaiting hello)');

  // ── Handshake timer: connection is idle until hello arrives ──
  // Until we have a profileId, the connection stays in pendingHandshakes
  // and is invisible to /command routing. If hello never arrives, we close.
  const handshakeTimer = setTimeout(() => {
    if (pendingHandshakes.has(ws)) {
      log.warn('[daemon] Extension did not send hello within timeout; closing');
      pendingHandshakes.delete(ws);
      ws.terminate();
    }
  }, HELLO_TIMEOUT_MS);
  pendingHandshakes.set(ws, handshakeTimer);

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

  // The profileId assigned to this connection (set on hello). Captured by
  // the close/error handlers below so we know whose pending to reject.
  let registeredProfileId: string | null = null;

  ws.on('message', (data: RawData) => {
    try {
      const msg = JSON.parse(data.toString());

      // Handle hello message from extension (version + identity handshake).
      const hello = parseHello(msg);
      if (hello) {
        // Clear handshake timer — this connection is now identified.
        const t = pendingHandshakes.get(ws);
        if (t) { clearTimeout(t); pendingHandshakes.delete(ws); }

        // Pre-multiplex extensions do not send profileId. Assign a synthetic
        // `legacy:<uuid>` so routing still works; a warning surfaces the fact
        // that multi-profile features will not apply to this connection.
        const profileId = hello.profileId ?? `legacy:${randomUUID()}`;
        const profileLabel = hello.profileLabel
          ?? (hello.profileId ? hello.profileId.slice(0, 8) : 'Legacy Extension');
        if (!hello.profileId) {
          log.warn('[daemon] Extension did not send profileId — assuming pre-multiplex build; multi-profile routing will treat it as a standalone connection');
        }

        // If this profileId is already connected (e.g. service worker restart),
        // kick the old connection out cleanly.
        const prior = extensions.get(profileId);
        if (prior && prior.ws !== ws) {
          log.info(`[daemon] Profile ${profileLabel} reconnected; closing prior connection`);
          rejectPendingFor(profileId, 'Extension reconnected');
          clearInterval(prior.heartbeatInterval);
          try { prior.ws.close(); } catch { /* already gone */ }
        }

        registeredProfileId = profileId;
        extensions.set(profileId, {
          ws,
          profileId,
          profileLabel,
          version: hello.version,
          compatRange: hello.compatRange,
          heartbeatInterval,
        });
        log.info(`[daemon] Extension registered: ${profileLabel} (${profileId.slice(0, 8)}…)`);
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

  const cleanup = (reason: string) => {
    clearInterval(heartbeatInterval);
    const t = pendingHandshakes.get(ws);
    if (t) { clearTimeout(t); pendingHandshakes.delete(ws); }
    if (registeredProfileId) {
      const current = extensions.get(registeredProfileId);
      if (current?.ws === ws) {
        extensions.delete(registeredProfileId);
        rejectPendingFor(registeredProfileId, reason);
      }
    }
  };

  ws.on('close', () => {
    log.info(`[daemon] Extension disconnected${registeredProfileId ? ` (${registeredProfileId.slice(0, 8)}…)` : ' (unregistered)'}`);
    cleanup('Extension disconnected');
  });

  ws.on('error', () => {
    // Reject pending requests in case 'close' does not follow this 'error'
    cleanup('Extension disconnected');
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
  for (const [, timer] of pendingHandshakes) clearTimeout(timer);
  pendingHandshakes.clear();
  for (const [, conn] of extensions) {
    clearInterval(conn.heartbeatInterval);
    try { conn.ws.close(); } catch { /* already gone */ }
  }
  extensions.clear();
  httpServer.close();
  process.exit(EXIT_CODES.SUCCESS);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
