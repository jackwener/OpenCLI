/**
 * OpenCLI — Offscreen Document (WebSocket host).
 *
 * Lives in an Offscreen document which Chrome never suspends, so the
 * WebSocket connection survives across Service Worker sleep/wake cycles.
 *
 * Message protocol with background.ts:
 *
 *   background → offscreen:
 *     { type: 'ws-connect' }           — (re-)establish WS connection
 *     { type: 'ws-send', payload: str} — send a raw string over WS
 *     { type: 'ws-status' }            — query connection state
 *
 *   offscreen → background:
 *     { type: 'ws-message', data: str }     — incoming WS frame
 *     { type: 'ws-status-reply', connected: bool, reconnecting: bool }
 *     { type: 'log', level, msg, ts }       — forward console output
 */

import { DAEMON_WS_URL, DAEMON_PING_URL, WS_RECONNECT_BASE_DELAY, WS_RECONNECT_MAX_DELAY } from './protocol';

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;

const MAX_EAGER_ATTEMPTS = 6;

// ─── Logging ─────────────────────────────────────────────────────────

function sendLog(level: 'info' | 'warn' | 'error', msg: string): void {
  chrome.runtime.sendMessage({ type: 'log', level, msg, ts: Date.now() }).catch(() => {/* SW may be asleep */});
}

const _origLog = console.log.bind(console);
const _origWarn = console.warn.bind(console);
const _origError = console.error.bind(console);

console.log = (...args: unknown[]) => {
  _origLog(...args);
  sendLog('info', args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '));
};
console.warn = (...args: unknown[]) => {
  _origWarn(...args);
  sendLog('warn', args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '));
};
console.error = (...args: unknown[]) => {
  _origError(...args);
  sendLog('error', args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '));
};

// ─── WebSocket ───────────────────────────────────────────────────────

async function connect(): Promise<void> {
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;

  // Skip HTTP ping — fetch to localhost is blocked in offscreen context.
  // WebSocket onerror will handle daemon-not-running gracefully.
  try {
    ws = new WebSocket(DAEMON_WS_URL);
  } catch {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log('[opencli/offscreen] Connected to daemon');
    reconnectAttempts = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    // Send hello — version comes from background, use a static marker here
    ws?.send(JSON.stringify({ type: 'hello', version: '__offscreen__' }));
    // Tell background we're up so it can send a proper hello with the real version
    chrome.runtime.sendMessage({ type: 'ws-connected' }).catch(() => {});
  };

  ws.onmessage = (event) => {
    chrome.runtime.sendMessage({ type: 'ws-message', data: event.data as string }).catch(() => {
      // SW may be sleeping — it will wake via alarm and re-check
    });
  };

  ws.onclose = () => {
    console.log('[opencli/offscreen] Disconnected from daemon');
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = () => {
    ws?.close();
  };
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectAttempts++;
  if (reconnectAttempts > MAX_EAGER_ATTEMPTS) return;
  const delay = Math.min(WS_RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1), WS_RECONNECT_MAX_DELAY);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, delay);
}

// ─── Message listener (from background) ─────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'ws-connect') {
    reconnectTimer = null;
    reconnectAttempts = 0;
    void connect();
    sendResponse({ ok: true });
    return false;
  }

  if (msg?.type === 'ws-send') {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(msg.payload as string);
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, error: 'WebSocket not open' });
    }
    return false;
  }

  if (msg?.type === 'ws-status') {
    sendResponse({
      type: 'ws-status-reply',
      connected: ws?.readyState === WebSocket.OPEN,
      reconnecting: reconnectTimer !== null,
    });
    return false;
  }

  return false;
});

// ─── Boot ────────────────────────────────────────────────────────────

void connect();
console.log('[opencli/offscreen] Offscreen document ready');
