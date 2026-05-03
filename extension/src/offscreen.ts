/**
 * Offscreen daemon bridge.
 *
 * MV3 service workers are suspendable, so they are the wrong place to own a
 * long-lived daemon WebSocket. This offscreen document owns transport and
 * relays commands to the service worker, where Chrome APIs are available.
 */

import type { BridgeInitMessage, Command, ExecuteCommandMessage, Result } from './protocol';
import { DAEMON_PING_URL, DAEMON_WS_URL, MSG_BRIDGE_INIT, MSG_EXECUTE_COMMAND, WS_RECONNECT_BASE_DELAY, WS_RECONNECT_MAX_DELAY } from './protocol';

type BridgeConfig = {
  contextId: string;
  version: string;
  compatRange: string;
};

let config: BridgeConfig | null = null;
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let testCurrentWebSocket: WebSocket | null = null;

async function connect(): Promise<void> {
  if (!config) return;
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;

  try {
    const res = await fetch(DAEMON_PING_URL, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) {
      scheduleReconnect();
      return;
    }
  } catch {
    scheduleReconnect();
    return;
  }

  try {
    ws = new WebSocket(DAEMON_WS_URL);
    testCurrentWebSocket = ws;
  } catch {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    if (!config) return;
    reconnectAttempts = 0;
    clearReconnectTimer();
    ws?.send(JSON.stringify({
      type: 'hello',
      contextId: config.contextId,
      version: config.version,
      compatRange: config.compatRange,
    }));
  };

  ws.onmessage = async (event) => {
    let command: Command;
    try {
      command = JSON.parse(event.data as string) as Command;
    } catch {
      return;
    }
    const result = await relayCommand(command);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(result));
    }
  };

  ws.onclose = () => {
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = () => {
    ws?.close();
  };
}

function clearReconnectTimer(): void {
  if (!reconnectTimer) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectAttempts++;
  const delay = Math.min(WS_RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1), WS_RECONNECT_MAX_DELAY);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, delay);
}

async function relayCommand(command: Command): Promise<Result> {
  try {
    const response = await chrome.runtime.sendMessage<ExecuteCommandMessage, Result>({
      type: MSG_EXECUTE_COMMAND,
      command,
    });
    if (response && typeof response === 'object' && typeof response.ok === 'boolean') return response;
    return { id: command.id, ok: false, error: 'Service worker returned an invalid OpenCLI result' };
  } catch (err) {
    return {
      id: command.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

chrome.runtime.onMessage.addListener((msg: unknown) => {
  if (!msg || typeof msg !== 'object' || (msg as { type?: unknown }).type !== MSG_BRIDGE_INIT) {
    return false;
  }
  const init = msg as BridgeInitMessage;
  config = {
    contextId: init.contextId,
    version: init.version,
    compatRange: init.compatRange,
  };
  void connect();
  return false;
});

export const __test__ = {
  connect,
  relayCommand,
  getState: () => ({
    configured: config !== null,
    reconnectAttempts,
    hasReconnectTimer: reconnectTimer !== null,
    wsReadyState: ws?.readyState,
    currentWebSocket: testCurrentWebSocket,
  }),
};
