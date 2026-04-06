const DAEMON_PORT = 19825;
const DAEMON_HOST = "localhost";
const DAEMON_WS_URL = `ws://${DAEMON_HOST}:${DAEMON_PORT}/ext`;
const DAEMON_PING_URL = `http://${DAEMON_HOST}:${DAEMON_PORT}/ping`;
const WS_RECONNECT_BASE_DELAY = 2e3;
const WS_RECONNECT_MAX_DELAY = 5e3;

const attached = /* @__PURE__ */ new Set();
const networkCaptures = /* @__PURE__ */ new Map();
function isDebuggableUrl$1(url) {
  if (!url) return true;
  return url.startsWith("http://") || url.startsWith("https://") || url === "about:blank" || url.startsWith("data:");
}
async function ensureAttached(tabId, aggressiveRetry = false) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!isDebuggableUrl$1(tab.url)) {
      attached.delete(tabId);
      throw new Error(`Cannot debug tab ${tabId}: URL is ${tab.url ?? "unknown"}`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Cannot debug tab")) throw e;
    attached.delete(tabId);
    throw new Error(`Tab ${tabId} no longer exists`);
  }
  if (attached.has(tabId)) {
    try {
      await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
        expression: "1",
        returnByValue: true
      });
      return;
    } catch {
      attached.delete(tabId);
    }
  }
  const MAX_ATTACH_RETRIES = aggressiveRetry ? 5 : 2;
  const RETRY_DELAY_MS = aggressiveRetry ? 1500 : 500;
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_ATTACH_RETRIES; attempt++) {
    try {
      try {
        await chrome.debugger.detach({ tabId });
      } catch {
      }
      await chrome.debugger.attach({ tabId }, "1.3");
      lastError = "";
      break;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      if (attempt < MAX_ATTACH_RETRIES) {
        console.warn(`[opencli] attach attempt ${attempt}/${MAX_ATTACH_RETRIES} failed: ${lastError}, retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
        try {
          const tab = await chrome.tabs.get(tabId);
          if (!isDebuggableUrl$1(tab.url)) {
            lastError = `Tab URL changed to ${tab.url} during retry`;
            break;
          }
        } catch {
          lastError = `Tab ${tabId} no longer exists`;
          break;
        }
      }
    }
  }
  if (lastError) {
    let finalUrl = "unknown";
    let finalWindowId = "unknown";
    try {
      const tab = await chrome.tabs.get(tabId);
      finalUrl = tab.url ?? "undefined";
      finalWindowId = String(tab.windowId);
    } catch {
    }
    console.warn(`[opencli] attach failed for tab ${tabId}: url=${finalUrl}, windowId=${finalWindowId}, error=${lastError}`);
    const hint = lastError.includes("chrome-extension://") ? ". Tip: another Chrome extension may be interfering — try disabling other extensions" : "";
    throw new Error(`attach failed: ${lastError}${hint}`);
  }
  attached.add(tabId);
  try {
    await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
  } catch {
  }
}
async function evaluate(tabId, expression, aggressiveRetry = false) {
  const MAX_EVAL_RETRIES = aggressiveRetry ? 3 : 2;
  for (let attempt = 1; attempt <= MAX_EVAL_RETRIES; attempt++) {
    try {
      await ensureAttached(tabId, aggressiveRetry);
      const result = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true
      });
      if (result.exceptionDetails) {
        const errMsg = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Eval error";
        throw new Error(errMsg);
      }
      return result.result?.value;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isNavigateError = msg.includes("Inspected target navigated") || msg.includes("Target closed");
      const isAttachError = isNavigateError || msg.includes("attach failed") || msg.includes("Debugger is not attached") || msg.includes("chrome-extension://");
      if (isAttachError && attempt < MAX_EVAL_RETRIES) {
        attached.delete(tabId);
        const retryMs = isNavigateError ? 200 : 500;
        await new Promise((resolve) => setTimeout(resolve, retryMs));
        continue;
      }
      throw e;
    }
  }
  throw new Error("evaluate: max retries exhausted");
}
const evaluateAsync = evaluate;
async function screenshot(tabId, options = {}) {
  await ensureAttached(tabId);
  const format = options.format ?? "png";
  if (options.fullPage) {
    const metrics = await chrome.debugger.sendCommand({ tabId }, "Page.getLayoutMetrics");
    const size = metrics.cssContentSize || metrics.contentSize;
    if (size) {
      await chrome.debugger.sendCommand({ tabId }, "Emulation.setDeviceMetricsOverride", {
        mobile: false,
        width: Math.ceil(size.width),
        height: Math.ceil(size.height),
        deviceScaleFactor: 1
      });
    }
  }
  try {
    const params = { format };
    if (format === "jpeg" && options.quality !== void 0) {
      params.quality = Math.max(0, Math.min(100, options.quality));
    }
    const result = await chrome.debugger.sendCommand({ tabId }, "Page.captureScreenshot", params);
    return result.data;
  } finally {
    if (options.fullPage) {
      await chrome.debugger.sendCommand({ tabId }, "Emulation.clearDeviceMetricsOverride").catch(() => {
      });
    }
  }
}
async function setFileInputFiles(tabId, files, selector) {
  await ensureAttached(tabId);
  await chrome.debugger.sendCommand({ tabId }, "DOM.enable");
  const doc = await chrome.debugger.sendCommand({ tabId }, "DOM.getDocument");
  const query = selector || 'input[type="file"]';
  const result = await chrome.debugger.sendCommand({ tabId }, "DOM.querySelector", {
    nodeId: doc.root.nodeId,
    selector: query
  });
  if (!result.nodeId) {
    throw new Error(`No element found matching selector: ${query}`);
  }
  await chrome.debugger.sendCommand({ tabId }, "DOM.setFileInputFiles", {
    files,
    nodeId: result.nodeId
  });
}
async function insertText(tabId, text) {
  await ensureAttached(tabId);
  await chrome.debugger.sendCommand({ tabId }, "Input.insertText", { text });
}
function normalizeCapturePatterns(pattern) {
  return String(pattern || "").split("|").map((part) => part.trim()).filter(Boolean);
}
function shouldCaptureUrl(url, patterns) {
  if (!url) return false;
  if (!patterns.length) return true;
  return patterns.some((pattern) => url.includes(pattern));
}
function normalizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    out[String(key)] = String(value);
  }
  return out;
}
function getOrCreateNetworkCaptureEntry(tabId, requestId, fallback) {
  const state = networkCaptures.get(tabId);
  if (!state) return null;
  const existingIndex = state.requestToIndex.get(requestId);
  if (existingIndex !== void 0) {
    return state.entries[existingIndex] || null;
  }
  const url = fallback?.url || "";
  if (!shouldCaptureUrl(url, state.patterns)) return null;
  const entry = {
    kind: "cdp",
    url,
    method: fallback?.method || "GET",
    requestHeaders: fallback?.requestHeaders || {},
    timestamp: Date.now()
  };
  state.entries.push(entry);
  state.requestToIndex.set(requestId, state.entries.length - 1);
  return entry;
}
async function startNetworkCapture(tabId, pattern) {
  await ensureAttached(tabId);
  await chrome.debugger.sendCommand({ tabId }, "Network.enable");
  networkCaptures.set(tabId, {
    patterns: normalizeCapturePatterns(pattern),
    entries: [],
    requestToIndex: /* @__PURE__ */ new Map()
  });
}
async function readNetworkCapture(tabId) {
  const state = networkCaptures.get(tabId);
  if (!state) return [];
  const entries = state.entries.slice();
  state.entries = [];
  state.requestToIndex.clear();
  return entries;
}
async function detach(tabId) {
  if (!attached.has(tabId)) return;
  attached.delete(tabId);
  networkCaptures.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
  }
}
function registerListeners() {
  chrome.tabs.onRemoved.addListener((tabId) => {
    attached.delete(tabId);
    networkCaptures.delete(tabId);
  });
  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId) {
      attached.delete(source.tabId);
      networkCaptures.delete(source.tabId);
    }
  });
  chrome.tabs.onUpdated.addListener(async (tabId, info) => {
    if (info.url && !isDebuggableUrl$1(info.url)) {
      await detach(tabId);
    }
  });
  chrome.debugger.onEvent.addListener(async (source, method, params) => {
    const tabId = source.tabId;
    if (!tabId) return;
    const state = networkCaptures.get(tabId);
    if (!state) return;
    if (method === "Network.requestWillBeSent") {
      const requestId = String(params?.requestId || "");
      const request = params?.request;
      const entry = getOrCreateNetworkCaptureEntry(tabId, requestId, {
        url: request?.url,
        method: request?.method,
        requestHeaders: normalizeHeaders(request?.headers)
      });
      if (!entry) return;
      entry.requestBodyKind = request?.hasPostData ? "string" : "empty";
      entry.requestBodyPreview = String(request?.postData || "").slice(0, 4e3);
      try {
        const postData = await chrome.debugger.sendCommand({ tabId }, "Network.getRequestPostData", { requestId });
        if (postData?.postData) {
          entry.requestBodyKind = "string";
          entry.requestBodyPreview = postData.postData.slice(0, 4e3);
        }
      } catch {
      }
      return;
    }
    if (method === "Network.responseReceived") {
      const requestId = String(params?.requestId || "");
      const response = params?.response;
      const entry = getOrCreateNetworkCaptureEntry(tabId, requestId, {
        url: response?.url
      });
      if (!entry) return;
      entry.responseStatus = response?.status;
      entry.responseContentType = response?.mimeType || "";
      entry.responseHeaders = normalizeHeaders(response?.headers);
      return;
    }
    if (method === "Network.loadingFinished") {
      const requestId = String(params?.requestId || "");
      const stateEntryIndex = state.requestToIndex.get(requestId);
      if (stateEntryIndex === void 0) return;
      const entry = state.entries[stateEntryIndex];
      if (!entry) return;
      try {
        const body = await chrome.debugger.sendCommand({ tabId }, "Network.getResponseBody", { requestId });
        if (typeof body?.body === "string") {
          entry.responsePreview = body.base64Encoded ? `base64:${body.body.slice(0, 4e3)}` : body.body.slice(0, 4e3);
        }
      } catch {
      }
    }
  });
}

let ws = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
const _origLog = console.log.bind(console);
const _origWarn = console.warn.bind(console);
const _origError = console.error.bind(console);
function forwardLog(level, args) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    const msg = args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
    ws.send(JSON.stringify({ type: "log", level, msg, ts: Date.now() }));
  } catch {
  }
}
console.log = (...args) => {
  _origLog(...args);
  forwardLog("info", args);
};
console.warn = (...args) => {
  _origWarn(...args);
  forwardLog("warn", args);
};
console.error = (...args) => {
  _origError(...args);
  forwardLog("error", args);
};
async function connect() {
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;
  try {
    const res = await fetch(DAEMON_PING_URL, { signal: AbortSignal.timeout(1e3) });
    if (!res.ok) return;
  } catch {
    return;
  }
  try {
    ws = new WebSocket(DAEMON_WS_URL);
  } catch {
    scheduleReconnect();
    return;
  }
  ws.onopen = () => {
    console.log("[opencli] Connected to daemon");
    reconnectAttempts = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    ws?.send(JSON.stringify({ type: "hello", version: chrome.runtime.getManifest().version }));
  };
  ws.onmessage = async (event) => {
    try {
      const command = JSON.parse(event.data);
      const result = await handleCommand(command);
      ws?.send(JSON.stringify(result));
    } catch (err) {
      console.error("[opencli] Message handling error:", err);
    }
  };
  ws.onclose = () => {
    console.log("[opencli] Disconnected from daemon");
    ws = null;
    scheduleReconnect();
  };
  ws.onerror = () => {
    ws?.close();
  };
}
const MAX_EAGER_ATTEMPTS = 6;
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
const automationSessions = /* @__PURE__ */ new Map();
const WINDOW_IDLE_TIMEOUT = 3e4;
function getWorkspaceKey(workspace) {
  return workspace?.trim() || "default";
}
function resetWindowIdleTimer(workspace) {
  const session = automationSessions.get(workspace);
  if (!session) return;
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleDeadlineAt = Date.now() + WINDOW_IDLE_TIMEOUT;
  session.idleTimer = setTimeout(async () => {
    const current = automationSessions.get(workspace);
    if (!current) return;
    if (!current.owned) {
      console.log(`[opencli] Borrowed workspace ${workspace} detached from window ${current.windowId} (idle timeout)`);
      automationSessions.delete(workspace);
      return;
    }
    try {
      await chrome.windows.remove(current.windowId);
      console.log(`[opencli] Automation window ${current.windowId} (${workspace}) closed (idle timeout)`);
    } catch {
    }
    automationSessions.delete(workspace);
  }, WINDOW_IDLE_TIMEOUT);
}
async function getAutomationWindow(workspace, initialUrl) {
  const existing = automationSessions.get(workspace);
  if (existing) {
    try {
      await chrome.windows.get(existing.windowId);
      return existing.windowId;
    } catch {
      automationSessions.delete(workspace);
    }
  }
  const startUrl = initialUrl && isSafeNavigationUrl(initialUrl) ? initialUrl : BLANK_PAGE;
  const win = await chrome.windows.create({
    url: startUrl,
    focused: false,
    width: 1280,
    height: 900,
    type: "normal"
  });
  const session = {
    windowId: win.id,
    idleTimer: null,
    idleDeadlineAt: Date.now() + WINDOW_IDLE_TIMEOUT,
    owned: true,
    preferredTabId: null
  };
  automationSessions.set(workspace, session);
  console.log(`[opencli] Created automation window ${session.windowId} (${workspace}, start=${startUrl})`);
  resetWindowIdleTimer(workspace);
  const tabs = await chrome.tabs.query({ windowId: win.id });
  if (tabs[0]?.id) {
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 500);
      const listener = (tabId, info) => {
        if (tabId === tabs[0].id && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(timeout);
          resolve();
        }
      };
      if (tabs[0].status === "complete") {
        clearTimeout(timeout);
        resolve();
      } else {
        chrome.tabs.onUpdated.addListener(listener);
      }
    });
  }
  return session.windowId;
}
chrome.windows.onRemoved.addListener((windowId) => {
  for (const [workspace, session] of automationSessions.entries()) {
    if (session.windowId === windowId) {
      console.log(`[opencli] Automation window closed (${workspace})`);
      if (session.idleTimer) clearTimeout(session.idleTimer);
      automationSessions.delete(workspace);
    }
  }
});
let initialized = false;
function initialize() {
  if (initialized) return;
  initialized = true;
  chrome.alarms.create("keepalive", { periodInMinutes: 0.4 });
  registerListeners();
  void connect();
  console.log("[opencli] OpenCLI extension initialized");
}
chrome.runtime.onInstalled.addListener(() => {
  initialize();
});
chrome.runtime.onStartup.addListener(() => {
  initialize();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "keepalive") void connect();
});
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "getStatus") {
    sendResponse({
      connected: ws?.readyState === WebSocket.OPEN,
      reconnecting: reconnectTimer !== null
    });
  }
  return false;
});
async function handleCommand(cmd) {
  const workspace = getWorkspaceKey(cmd.workspace);
  resetWindowIdleTimer(workspace);
  try {
    switch (cmd.action) {
      case "exec":
        return await handleExec(cmd, workspace);
      case "navigate":
        return await handleNavigate(cmd, workspace);
      case "tabs":
        return await handleTabs(cmd, workspace);
      case "cookies":
        return await handleCookies(cmd);
      case "screenshot":
        return await handleScreenshot(cmd, workspace);
      case "close-window":
        return await handleCloseWindow(cmd, workspace);
      case "cdp":
        return await handleCdp(cmd, workspace);
      case "sessions":
        return await handleSessions(cmd);
      case "set-file-input":
        return await handleSetFileInput(cmd, workspace);
      case "insert-text":
        return await handleInsertText(cmd, workspace);
      case "bind-current":
        return await handleBindCurrent(cmd, workspace);
      case "network-capture-start":
        return await handleNetworkCaptureStart(cmd, workspace);
      case "network-capture-read":
        return await handleNetworkCaptureRead(cmd, workspace);
      default:
        return { id: cmd.id, ok: false, error: `Unknown action: ${cmd.action}` };
    }
  } catch (err) {
    return {
      id: cmd.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}
const BLANK_PAGE = "about:blank";
function isDebuggableUrl(url) {
  if (!url) return true;
  return url.startsWith("http://") || url.startsWith("https://") || url === "about:blank" || url.startsWith("data:");
}
function isSafeNavigationUrl(url) {
  return url.startsWith("http://") || url.startsWith("https://");
}
function normalizeUrlForComparison(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:" && parsed.port === "443" || parsed.protocol === "http:" && parsed.port === "80") {
      parsed.port = "";
    }
    const pathname = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.protocol}//${parsed.host}${pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}
function isTargetUrl(currentUrl, targetUrl) {
  return normalizeUrlForComparison(currentUrl) === normalizeUrlForComparison(targetUrl);
}
function matchesDomain(url, domain) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}
function matchesBindCriteria(tab, cmd) {
  if (!tab.id || !isDebuggableUrl(tab.url)) return false;
  if (cmd.matchDomain && !matchesDomain(tab.url, cmd.matchDomain)) return false;
  if (cmd.matchPathPrefix) {
    try {
      const parsed = new URL(tab.url);
      if (!parsed.pathname.startsWith(cmd.matchPathPrefix)) return false;
    } catch {
      return false;
    }
  }
  return true;
}
function setWorkspaceSession(workspace, session) {
  const existing = automationSessions.get(workspace);
  if (existing?.idleTimer) clearTimeout(existing.idleTimer);
  automationSessions.set(workspace, {
    ...session,
    idleTimer: null,
    idleDeadlineAt: Date.now() + WINDOW_IDLE_TIMEOUT
  });
}
async function resolveTab(tabId, workspace, initialUrl) {
  if (tabId !== void 0) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const session = automationSessions.get(workspace);
      const matchesSession = session ? session.preferredTabId !== null ? session.preferredTabId === tabId : tab.windowId === session.windowId : false;
      if (isDebuggableUrl(tab.url) && matchesSession) return { tabId, tab };
      if (session && !matchesSession && session.preferredTabId === null && isDebuggableUrl(tab.url)) {
        console.warn(`[opencli] Tab ${tabId} drifted to window ${tab.windowId}, moving back to ${session.windowId}`);
        try {
          await chrome.tabs.move(tabId, { windowId: session.windowId, index: -1 });
          const moved = await chrome.tabs.get(tabId);
          if (moved.windowId === session.windowId && isDebuggableUrl(moved.url)) {
            return { tabId, tab: moved };
          }
        } catch (moveErr) {
          console.warn(`[opencli] Failed to move tab back: ${moveErr}`);
        }
      } else if (!isDebuggableUrl(tab.url)) {
        console.warn(`[opencli] Tab ${tabId} URL is not debuggable (${tab.url}), re-resolving`);
      }
    } catch {
      console.warn(`[opencli] Tab ${tabId} no longer exists, re-resolving`);
    }
  }
  const existingSession = automationSessions.get(workspace);
  if (existingSession?.preferredTabId !== null) {
    try {
      const preferredTab = await chrome.tabs.get(existingSession.preferredTabId);
      if (isDebuggableUrl(preferredTab.url)) return { tabId: preferredTab.id, tab: preferredTab };
    } catch {
      automationSessions.delete(workspace);
    }
  }
  const windowId = await getAutomationWindow(workspace, initialUrl);
  const tabs = await chrome.tabs.query({ windowId });
  const debuggableTab = tabs.find((t) => t.id && isDebuggableUrl(t.url));
  if (debuggableTab?.id) return { tabId: debuggableTab.id, tab: debuggableTab };
  const reuseTab = tabs.find((t) => t.id);
  if (reuseTab?.id) {
    await chrome.tabs.update(reuseTab.id, { url: BLANK_PAGE });
    await new Promise((resolve) => setTimeout(resolve, 300));
    try {
      const updated = await chrome.tabs.get(reuseTab.id);
      if (isDebuggableUrl(updated.url)) return { tabId: reuseTab.id, tab: updated };
      console.warn(`[opencli] data: URI was intercepted (${updated.url}), creating fresh tab`);
    } catch {
    }
  }
  const newTab = await chrome.tabs.create({ windowId, url: BLANK_PAGE, active: true });
  if (!newTab.id) throw new Error("Failed to create tab in automation window");
  return { tabId: newTab.id, tab: newTab };
}
async function resolveTabId(tabId, workspace, initialUrl) {
  const resolved = await resolveTab(tabId, workspace, initialUrl);
  return resolved.tabId;
}
async function listAutomationTabs(workspace) {
  const session = automationSessions.get(workspace);
  if (!session) return [];
  if (session.preferredTabId !== null) {
    try {
      return [await chrome.tabs.get(session.preferredTabId)];
    } catch {
      automationSessions.delete(workspace);
      return [];
    }
  }
  try {
    return await chrome.tabs.query({ windowId: session.windowId });
  } catch {
    automationSessions.delete(workspace);
    return [];
  }
}
async function listAutomationWebTabs(workspace) {
  const tabs = await listAutomationTabs(workspace);
  return tabs.filter((tab) => isDebuggableUrl(tab.url));
}
async function handleExec(cmd, workspace) {
  if (!cmd.code) return { id: cmd.id, ok: false, error: "Missing code" };
  const tabId = await resolveTabId(cmd.tabId, workspace);
  try {
    const aggressive = workspace.startsWith("operate:");
    const data = await evaluateAsync(tabId, cmd.code, aggressive);
    return { id: cmd.id, ok: true, data };
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
async function handleNavigate(cmd, workspace) {
  if (!cmd.url) return { id: cmd.id, ok: false, error: "Missing url" };
  if (!isSafeNavigationUrl(cmd.url)) {
    return { id: cmd.id, ok: false, error: "Blocked URL scheme -- only http:// and https:// are allowed" };
  }
  const resolved = await resolveTab(cmd.tabId, workspace, cmd.url);
  const tabId = resolved.tabId;
  const beforeTab = resolved.tab ?? await chrome.tabs.get(tabId);
  const beforeNormalized = normalizeUrlForComparison(beforeTab.url);
  const targetUrl = cmd.url;
  if (beforeTab.status === "complete" && isTargetUrl(beforeTab.url, targetUrl)) {
    return {
      id: cmd.id,
      ok: true,
      data: { title: beforeTab.title, url: beforeTab.url, tabId, timedOut: false }
    };
  }
  await detach(tabId);
  await chrome.tabs.update(tabId, { url: targetUrl });
  let timedOut = false;
  await new Promise((resolve) => {
    let settled = false;
    let checkTimer = null;
    let timeoutTimer = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      if (checkTimer) clearTimeout(checkTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      resolve();
    };
    const isNavigationDone = (url) => {
      return isTargetUrl(url, targetUrl) || normalizeUrlForComparison(url) !== beforeNormalized;
    };
    const listener = (id, info, tab2) => {
      if (id !== tabId) return;
      if (info.status === "complete" && isNavigationDone(tab2.url ?? info.url)) {
        finish();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    checkTimer = setTimeout(async () => {
      try {
        const currentTab = await chrome.tabs.get(tabId);
        if (currentTab.status === "complete" && isNavigationDone(currentTab.url)) {
          finish();
        }
      } catch {
      }
    }, 100);
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      console.warn(`[opencli] Navigate to ${targetUrl} timed out after 15s`);
      finish();
    }, 15e3);
  });
  let tab = await chrome.tabs.get(tabId);
  const session = automationSessions.get(workspace);
  if (session && tab.windowId !== session.windowId) {
    console.warn(`[opencli] Tab ${tabId} drifted to window ${tab.windowId} during navigation, moving back to ${session.windowId}`);
    try {
      await chrome.tabs.move(tabId, { windowId: session.windowId, index: -1 });
      tab = await chrome.tabs.get(tabId);
    } catch (moveErr) {
      console.warn(`[opencli] Failed to recover drifted tab: ${moveErr}`);
    }
  }
  return {
    id: cmd.id,
    ok: true,
    data: { title: tab.title, url: tab.url, tabId, timedOut }
  };
}
async function handleTabs(cmd, workspace) {
  switch (cmd.op) {
    case "list": {
      const tabs = await listAutomationWebTabs(workspace);
      const data = tabs.map((t, i) => ({
        index: i,
        tabId: t.id,
        url: t.url,
        title: t.title,
        active: t.active
      }));
      return { id: cmd.id, ok: true, data };
    }
    case "new": {
      if (cmd.url && !isSafeNavigationUrl(cmd.url)) {
        return { id: cmd.id, ok: false, error: "Blocked URL scheme -- only http:// and https:// are allowed" };
      }
      const windowId = await getAutomationWindow(workspace);
      const tab = await chrome.tabs.create({ windowId, url: cmd.url ?? BLANK_PAGE, active: true });
      return { id: cmd.id, ok: true, data: { tabId: tab.id, url: tab.url } };
    }
    case "close": {
      if (cmd.index !== void 0) {
        const tabs = await listAutomationWebTabs(workspace);
        const target = tabs[cmd.index];
        if (!target?.id) return { id: cmd.id, ok: false, error: `Tab index ${cmd.index} not found` };
        await chrome.tabs.remove(target.id);
        await detach(target.id);
        return { id: cmd.id, ok: true, data: { closed: target.id } };
      }
      const tabId = await resolveTabId(cmd.tabId, workspace);
      await chrome.tabs.remove(tabId);
      await detach(tabId);
      return { id: cmd.id, ok: true, data: { closed: tabId } };
    }
    case "select": {
      if (cmd.index === void 0 && cmd.tabId === void 0)
        return { id: cmd.id, ok: false, error: "Missing index or tabId" };
      if (cmd.tabId !== void 0) {
        const session = automationSessions.get(workspace);
        let tab;
        try {
          tab = await chrome.tabs.get(cmd.tabId);
        } catch {
          return { id: cmd.id, ok: false, error: `Tab ${cmd.tabId} no longer exists` };
        }
        if (!session || tab.windowId !== session.windowId) {
          return { id: cmd.id, ok: false, error: `Tab ${cmd.tabId} is not in the automation window` };
        }
        await chrome.tabs.update(cmd.tabId, { active: true });
        return { id: cmd.id, ok: true, data: { selected: cmd.tabId } };
      }
      const tabs = await listAutomationWebTabs(workspace);
      const target = tabs[cmd.index];
      if (!target?.id) return { id: cmd.id, ok: false, error: `Tab index ${cmd.index} not found` };
      await chrome.tabs.update(target.id, { active: true });
      return { id: cmd.id, ok: true, data: { selected: target.id } };
    }
    default:
      return { id: cmd.id, ok: false, error: `Unknown tabs op: ${cmd.op}` };
  }
}
async function handleCookies(cmd) {
  if (!cmd.domain && !cmd.url) {
    return { id: cmd.id, ok: false, error: "Cookie scope required: provide domain or url to avoid dumping all cookies" };
  }
  const details = {};
  if (cmd.domain) details.domain = cmd.domain;
  if (cmd.url) details.url = cmd.url;
  const cookies = await chrome.cookies.getAll(details);
  const data = cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    expirationDate: c.expirationDate
  }));
  return { id: cmd.id, ok: true, data };
}
async function handleScreenshot(cmd, workspace) {
  const tabId = await resolveTabId(cmd.tabId, workspace);
  try {
    const data = await screenshot(tabId, {
      format: cmd.format,
      quality: cmd.quality,
      fullPage: cmd.fullPage
    });
    return { id: cmd.id, ok: true, data };
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
const CDP_ALLOWLIST = /* @__PURE__ */ new Set([
  // Agent DOM context
  "Accessibility.getFullAXTree",
  "DOM.getDocument",
  "DOM.getBoxModel",
  "DOM.getContentQuads",
  "DOM.querySelectorAll",
  "DOM.scrollIntoViewIfNeeded",
  "DOMSnapshot.captureSnapshot",
  // Native input events
  "Input.dispatchMouseEvent",
  "Input.dispatchKeyEvent",
  "Input.insertText",
  // Page metrics & screenshots
  "Page.getLayoutMetrics",
  "Page.captureScreenshot",
  // Runtime.enable needed for CDP attach setup (Runtime.evaluate goes through 'exec' action)
  "Runtime.enable",
  // Emulation (used by screenshot full-page)
  "Emulation.setDeviceMetricsOverride",
  "Emulation.clearDeviceMetricsOverride"
]);
async function handleCdp(cmd, workspace) {
  if (!cmd.cdpMethod) return { id: cmd.id, ok: false, error: "Missing cdpMethod" };
  if (!CDP_ALLOWLIST.has(cmd.cdpMethod)) {
    return { id: cmd.id, ok: false, error: `CDP method not permitted: ${cmd.cdpMethod}` };
  }
  const tabId = await resolveTabId(cmd.tabId, workspace);
  try {
    const aggressive = workspace.startsWith("operate:");
    await ensureAttached(tabId, aggressive);
    const data = await chrome.debugger.sendCommand(
      { tabId },
      cmd.cdpMethod,
      cmd.cdpParams ?? {}
    );
    return { id: cmd.id, ok: true, data };
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
async function handleCloseWindow(cmd, workspace) {
  const session = automationSessions.get(workspace);
  if (session) {
    if (session.owned) {
      try {
        await chrome.windows.remove(session.windowId);
      } catch {
      }
    }
    if (session.idleTimer) clearTimeout(session.idleTimer);
    automationSessions.delete(workspace);
  }
  return { id: cmd.id, ok: true, data: { closed: true } };
}
async function handleSetFileInput(cmd, workspace) {
  if (!cmd.files || !Array.isArray(cmd.files) || cmd.files.length === 0) {
    return { id: cmd.id, ok: false, error: "Missing or empty files array" };
  }
  const tabId = await resolveTabId(cmd.tabId, workspace);
  try {
    await setFileInputFiles(tabId, cmd.files, cmd.selector);
    return { id: cmd.id, ok: true, data: { count: cmd.files.length } };
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
async function handleInsertText(cmd, workspace) {
  if (typeof cmd.text !== "string") {
    return { id: cmd.id, ok: false, error: "Missing text payload" };
  }
  const tabId = await resolveTabId(cmd.tabId, workspace);
  try {
    await insertText(tabId, cmd.text);
    return { id: cmd.id, ok: true, data: { inserted: true } };
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
async function handleNetworkCaptureStart(cmd, workspace) {
  const tabId = await resolveTabId(cmd.tabId, workspace);
  try {
    await startNetworkCapture(tabId, cmd.pattern);
    return { id: cmd.id, ok: true, data: { started: true } };
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
async function handleNetworkCaptureRead(cmd, workspace) {
  const tabId = await resolveTabId(cmd.tabId, workspace);
  try {
    const data = await readNetworkCapture(tabId);
    return { id: cmd.id, ok: true, data };
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
async function handleSessions(cmd) {
  const now = Date.now();
  const data = await Promise.all([...automationSessions.entries()].map(async ([workspace, session]) => ({
    workspace,
    windowId: session.windowId,
    tabCount: (await chrome.tabs.query({ windowId: session.windowId })).filter((tab) => isDebuggableUrl(tab.url)).length,
    idleMsRemaining: Math.max(0, session.idleDeadlineAt - now)
  })));
  return { id: cmd.id, ok: true, data };
}
async function handleBindCurrent(cmd, workspace) {
  const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const fallbackTabs = await chrome.tabs.query({ lastFocusedWindow: true });
  const allTabs = await chrome.tabs.query({});
  const boundTab = activeTabs.find((tab) => matchesBindCriteria(tab, cmd)) ?? fallbackTabs.find((tab) => matchesBindCriteria(tab, cmd)) ?? allTabs.find((tab) => matchesBindCriteria(tab, cmd));
  if (!boundTab?.id) {
    return {
      id: cmd.id,
      ok: false,
      error: cmd.matchDomain || cmd.matchPathPrefix ? `No visible tab matching ${cmd.matchDomain ?? "domain"}${cmd.matchPathPrefix ? ` ${cmd.matchPathPrefix}` : ""}` : "No active debuggable tab found"
    };
  }
  setWorkspaceSession(workspace, {
    windowId: boundTab.windowId,
    owned: false,
    preferredTabId: boundTab.id
  });
  resetWindowIdleTimer(workspace);
  console.log(`[opencli] Workspace ${workspace} explicitly bound to tab ${boundTab.id} (${boundTab.url})`);
  return {
    id: cmd.id,
    ok: true,
    data: {
      tabId: boundTab.id,
      windowId: boundTab.windowId,
      url: boundTab.url,
      title: boundTab.title,
      workspace
    }
  };
}
