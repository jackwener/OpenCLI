const DAEMON_PORT = 19825;
const DAEMON_HOST = "localhost";
const DAEMON_WS_URL = `ws://${DAEMON_HOST}:${DAEMON_PORT}/ext`;
const WS_RECONNECT_BASE_DELAY = 2e3;
const WS_RECONNECT_MAX_DELAY = 6e4;

let ws = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
const MAX_EAGER_ATTEMPTS = 6;
function sendLog(level, msg) {
  chrome.runtime.sendMessage({ type: "log", level, msg, ts: Date.now() }).catch(() => {
  });
}
const _origLog = console.log.bind(console);
const _origWarn = console.warn.bind(console);
const _origError = console.error.bind(console);
console.log = (...args) => {
  _origLog(...args);
  sendLog("info", args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" "));
};
console.warn = (...args) => {
  _origWarn(...args);
  sendLog("warn", args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" "));
};
console.error = (...args) => {
  _origError(...args);
  sendLog("error", args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" "));
};
async function connect() {
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;
  try {
    ws = new WebSocket(DAEMON_WS_URL);
  } catch {
    scheduleReconnect();
    return;
  }
  ws.onopen = () => {
    console.log("[opencli/offscreen] Connected to daemon");
    reconnectAttempts = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    ws?.send(JSON.stringify({ type: "hello", version: "__offscreen__" }));
    chrome.runtime.sendMessage({ type: "ws-connected" }).catch(() => {
    });
  };
  ws.onmessage = (event) => {
    chrome.runtime.sendMessage({ type: "ws-message", data: event.data }).catch(() => {
    });
  };
  ws.onclose = () => {
    console.log("[opencli/offscreen] Disconnected from daemon");
    ws = null;
    scheduleReconnect();
  };
  ws.onerror = () => {
    ws?.close();
  };
}
function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectAttempts++;
  if (reconnectAttempts > MAX_EAGER_ATTEMPTS) return;
  const delay = Math.min(WS_RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1), WS_RECONNECT_MAX_DELAY);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, delay);
}
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "ws-connect") {
    reconnectTimer = null;
    reconnectAttempts = 0;
    void connect();
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === "ws-send") {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(msg.payload);
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, error: "WebSocket not open" });
    }
    return false;
  }
  if (msg?.type === "ws-status") {
    sendResponse({
      type: "ws-status-reply",
      connected: ws?.readyState === WebSocket.OPEN,
      reconnecting: reconnectTimer !== null
    });
    return false;
  }
  return false;
});
void connect();
console.log("[opencli/offscreen] Offscreen document ready");
