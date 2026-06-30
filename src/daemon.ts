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
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { DEFAULT_DAEMON_PORT } from './constants.js';
import { EXIT_CODES } from './errors.js';
import { log } from './logger.js';
import { PKG_VERSION } from './version.js';
import { DEFAULT_CONTEXT_ID } from './browser/profile.js';
import { recordExtensionVersion } from './update-check.js';
import {
  buildCommandDispatchFailure,
  buildExtensionDisconnectFailure,
  getResponseCorsHeaders,
} from './daemon-utils.js';

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
  action: string;
  dispatched: boolean;
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>();
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

type AutofillKeychainConfig = {
  service: string;
  account: string;
  format: 'json';
};

type AutofillConfigEntry = {
  id: string;
  contextId: string;
  allowedHosts: string[];
  matchHosts?: string[];
  usernameSelectors?: string[];
  passwordSelectors?: string[];
  activateTextPatterns?: string[];
  submitSelectors?: string[];
  submit?: boolean;
  keychain: AutofillKeychainConfig;
};

type AutofillConfig = {
  version: 1;
  entries: AutofillConfigEntry[];
};

type AutofillRequestMessage = {
  type: 'autofill-request';
  requestId: string;
  contextId?: string;
  url?: string;
};

type StoredCredential = {
  username: string;
  password: string;
};

function openCliConfigDir(): string {
  return process.env.OPENCLI_CONFIG_DIR || path.join(os.homedir(), '.opencli');
}

function browserAutofillConfigPath(): string {
  return path.join(openCliConfigDir(), 'browser-autofill.json');
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function cleanStringArray(value: unknown): string[] {
  if (!isStringArray(value)) return [];
  return value.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
}

function parseAutofillEntry(value: unknown): AutofillConfigEntry | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const keychain = record.keychain;
  if (!keychain || typeof keychain !== 'object') return null;
  const keychainRecord = keychain as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id.trim() : '';
  const contextId = typeof record.contextId === 'string' ? record.contextId.trim() : '';
  const service = typeof keychainRecord.service === 'string' ? keychainRecord.service.trim() : '';
  const account = typeof keychainRecord.account === 'string' ? keychainRecord.account.trim() : '';
  const allowedHosts = cleanStringArray(record.allowedHosts);
  if (!id || !contextId || !service || !account || allowedHosts.length === 0) return null;
  return {
    id,
    contextId,
    allowedHosts,
    matchHosts: cleanStringArray(record.matchHosts),
    usernameSelectors: cleanStringArray(record.usernameSelectors),
    passwordSelectors: cleanStringArray(record.passwordSelectors),
    activateTextPatterns: cleanStringArray(record.activateTextPatterns),
    submitSelectors: cleanStringArray(record.submitSelectors),
    submit: record.submit === true,
    keychain: {
      service,
      account,
      format: 'json',
    },
  };
}

function loadAutofillConfig(): AutofillConfig {
  try {
    const parsed = JSON.parse(fs.readFileSync(browserAutofillConfigPath(), 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object') return { version: 1, entries: [] };
    const entriesValue = (parsed as Record<string, unknown>).entries;
    const entries = Array.isArray(entriesValue)
      ? entriesValue.map(parseAutofillEntry).filter((entry): entry is AutofillConfigEntry => entry !== null)
      : [];
    return { version: 1, entries };
  } catch {
    return { version: 1, entries: [] };
  }
}

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/^\.+/, '');
}

function hostMatches(host: string, allowedHost: string): boolean {
  const normalizedHost = normalizeHost(host);
  const normalizedAllowed = normalizeHost(allowedHost);
  return normalizedAllowed.length > 0
    && (normalizedHost === normalizedAllowed || normalizedHost.endsWith(`.${normalizedAllowed}`));
}

function selectAutofillEntry(contextId: string, rawUrl: string): AutofillConfigEntry | null {
  let host = '';
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    host = url.hostname;
  } catch {
    return null;
  }
  const config = loadAutofillConfig();
  return config.entries.find((entry) => {
    if (entry.contextId !== contextId) return false;
    const matchHosts = entry.matchHosts && entry.matchHosts.length > 0 ? entry.matchHosts : entry.allowedHosts;
    return matchHosts.some((allowedHost) => hostMatches(host, allowedHost));
  }) ?? null;
}

function parseStoredCredential(raw: string): StoredCredential | null {
  const text = raw.trim();
  if (!text) return null;
  const payload = /^[0-9a-f]+$/i.test(text) && text.length % 2 === 0
    ? Buffer.from(text, 'hex').toString('utf8').trim()
    : text;
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    const username = typeof record.username === 'string' ? record.username : '';
    const password = typeof record.password === 'string' ? record.password : '';
    if (!username || !password) return null;
    return { username, password };
  } catch {
    return null;
  }
}

function readKeychainCredential(config: AutofillKeychainConfig): StoredCredential | null {
  if (process.platform !== 'darwin') return null;
  const result = spawnSync('/usr/bin/security', [
    'find-generic-password',
    '-s', config.service,
    '-a', config.account,
    '-w',
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0 || !result.stdout.trim()) return null;
  return parseStoredCredential(result.stdout);
}

function isAutofillRequestMessage(value: unknown): value is AutofillRequestMessage {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.type === 'autofill-request' && typeof record.requestId === 'string';
}

function respondToAutofillRequest(ws: WebSocket, requestId: string, payload: Record<string, unknown>): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    type: 'autofill-response',
    requestId,
    ...payload,
  }));
}

function handleAutofillRequest(ws: WebSocket, msg: AutofillRequestMessage): void {
  const connection = [...extensionProfiles.values()].find((entry) => entry.ws === ws && entry.ws.readyState === WebSocket.OPEN);
  const contextId = connection?.contextId ?? (typeof msg.contextId === 'string' ? msg.contextId.trim() : '');
  const rawUrl = typeof msg.url === 'string' ? msg.url : '';
  if (!contextId || !rawUrl) {
    respondToAutofillRequest(ws, msg.requestId, { ok: false, error: 'missing_context_or_url' });
    return;
  }
  const entry = selectAutofillEntry(contextId, rawUrl);
  if (!entry) {
    respondToAutofillRequest(ws, msg.requestId, { ok: false, error: 'no_matching_autofill_entry' });
    return;
  }
  const credential = readKeychainCredential(entry.keychain);
  if (!credential) {
    respondToAutofillRequest(ws, msg.requestId, { ok: false, error: 'credential_not_found' });
    return;
  }
  respondToAutofillRequest(ws, msg.requestId, {
    ok: true,
    credential: {
      username: credential.username,
      password: credential.password,
      allowedHosts: entry.allowedHosts,
      usernameSelectors: entry.usernameSelectors ?? [],
      passwordSelectors: entry.passwordSelectors ?? [],
      activateTextPatterns: entry.activateTextPatterns ?? [],
      submitSelectors: entry.submitSelectors ?? [],
      submit: entry.submit === true,
    },
  });
}

function pushLog(entry: LogEntry): void {
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
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
      const failure = buildExtensionDisconnectFailure({
        contextId,
        action: p.action,
        dispatched: p.dispatched,
      });
      if (failure.countAsCommandResultUnknown) {
        commandResultUnknownCount++;
        log.warn(`[daemon] Command result unknown after extension disconnect (id=${id}, action=${p.action}, context=${contextId})`);
      }
      p.reject(new DaemonCommandFailure(failure.message, failure.errorCode, failure.errorHint, failure.status));
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
        const entry = {
          contextId: route.connection!.contextId,
          action: typeof body.action === 'string' ? body.action : 'unknown',
          dispatched: false,
          resolve,
          reject,
          timer,
        };
        pending.set(body.id, entry);
        const failBeforeDispatch = (err: unknown) => {
          if (pending.get(body.id) !== entry) return;
          const failure = buildCommandDispatchFailure(entry.contextId);
          clearTimeout(timer);
          pending.delete(body.id);
          reject(new DaemonCommandFailure(failure.message, failure.errorCode, failure.errorHint, failure.status));
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

      // Extension-initiated passive autofill requests. These are not CLI
      // commands: the extension observes a configured login page and asks the
      // local daemon for that profile's Keychain-backed credential.
      if (isAutofillRequestMessage(msg)) {
        handleAutofillRequest(ws, msg);
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
