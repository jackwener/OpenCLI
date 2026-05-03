import { a as MSG_BRIDGE_INIT, D as DAEMON_PING_URL, b as DAEMON_WS_URL, M as MSG_EXECUTE_COMMAND, W as WS_RECONNECT_BASE_DELAY, c as WS_RECONNECT_MAX_DELAY } from './assets/protocol.js';

let config = null;
let ws = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let testCurrentWebSocket = null;
async function connect() {
  if (!config) return;
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;
  try {
    const res = await fetch(DAEMON_PING_URL, { signal: AbortSignal.timeout(2e3) });
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
      type: "hello",
      contextId: config.contextId,
      version: config.version,
      compatRange: config.compatRange
    }));
  };
  ws.onmessage = async (event) => {
    let command;
    try {
      command = JSON.parse(event.data);
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
function clearReconnectTimer() {
  if (!reconnectTimer) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}
function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectAttempts++;
  const delay = Math.min(WS_RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1), WS_RECONNECT_MAX_DELAY);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, delay);
}
async function relayCommand(command) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: MSG_EXECUTE_COMMAND,
      command
    });
    if (response && typeof response === "object" && typeof response.ok === "boolean") return response;
    return { id: command.id, ok: false, error: "Service worker returned an invalid OpenCLI result" };
  } catch (err) {
    return {
      id: command.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || typeof msg !== "object" || msg.type !== MSG_BRIDGE_INIT) {
    return false;
  }
  const init = msg;
  config = {
    contextId: init.contextId,
    version: init.version,
    compatRange: init.compatRange
  };
  void connect();
  return false;
});
