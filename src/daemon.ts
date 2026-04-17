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
 *   3. No CORS headers — responses never include Access-Control-Allow-Origin
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

const PORT = parseInt(process.env.OPENCLI_DAEMON_PORT ?? String(DEFAULT_DAEMON_PORT), 10);

// ─── State ───────────────────────────────────────────────────────────

let extensionWs: WebSocket | null = null;
let extensionVersion: string | null = null;
let extensionCompatRange: string | null = null;
const pending = new Map<string, {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>();
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

function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
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
    jsonResponse(res, 200, { ok: true });
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
    jsonResponse(res, 200, {
      ok: true,
      pid: process.pid,
      uptime,
      daemonVersion: PKG_VERSION,
      extensionConnected: extensionWs?.readyState === WebSocket.OPEN,
      extensionVersion,
      extensionCompatRange,
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

      if (!extensionWs || extensionWs.readyState !== WebSocket.OPEN) {
        jsonResponse(res, 503, { id: body.id, ok: false, error: 'Extension not connected. Please install the opencli Browser Bridge extension.' });
        return;
      }

      const timeoutMs = typeof body.timeout === 'number' && body.timeout > 0
        ? body.timeout * 1000
        : 120000;
      const result = await new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(body.id);
          reject(new Error(`Command timeout (${timeoutMs / 1000}s)`));
        }, timeoutMs);
        pending.set(body.id, { resolve, reject, timer });
        extensionWs!.send(JSON.stringify(body));
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
  log.info('[daemon] Extension connected');
  extensionWs = ws;
  extensionVersion = null; // cleared until hello message arrives
  extensionCompatRange = null;

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
        extensionVersion = typeof msg.version === 'string' ? msg.version : null;
        extensionCompatRange = typeof msg.compatRange === 'string' ? msg.compatRange : null;
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

  ws.on('close', () => {
    log.info('[daemon] Extension disconnected');
    clearInterval(heartbeatInterval);
    if (extensionWs === ws) {
      extensionWs = null;
      extensionVersion = null;
      extensionCompatRange = null;
      // Reject all pending requests since the extension is gone
      for (const [id, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new Error('Extension disconnected'));
      }
      pending.clear();
    }
  });

  ws.on('error', () => {
    clearInterval(heartbeatInterval);
    if (extensionWs === ws) {
      extensionWs = null;
      extensionVersion = null;
      // Reject pending requests in case 'close' does not follow this 'error'
      for (const [, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new Error('Extension disconnected'));
      }
      pending.clear();
    }
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
  if (extensionWs) extensionWs.close();
  httpServer.close();
  process.exit(EXIT_CODES.SUCCESS);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
