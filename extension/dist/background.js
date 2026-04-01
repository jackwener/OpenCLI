const DAEMON_PORT = 19825;
const DAEMON_HOST = "localhost";
const DAEMON_WS_URL = `ws://${DAEMON_HOST}:${DAEMON_PORT}/ext`;
const DAEMON_PING_URL = `http://${DAEMON_HOST}:${DAEMON_PORT}/ping`;
const WS_RECONNECT_BASE_DELAY = 2e3;
const WS_RECONNECT_MAX_DELAY = 5e3;

const attached = /* @__PURE__ */ new Set();
const BLANK_PAGE$1 = "data:text/html,<html></html>";
const FOREIGN_EXTENSION_URL_PREFIX = "chrome-extension://";
const ATTACH_RECOVERY_DELAY_MS = 120;
function isDebuggableUrl$1(url) {
  if (!url) return true;
  return url.startsWith("http://") || url.startsWith("https://") || url === BLANK_PAGE$1;
}
async function removeForeignExtensionEmbeds(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || !tab.url.startsWith("http://") && !tab.url.startsWith("https://")) {
    return { removed: 0 };
  }
  if (!chrome.scripting?.executeScript) return { removed: 0 };
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [`${FOREIGN_EXTENSION_URL_PREFIX}${chrome.runtime.id}/`],
      func: (ownExtensionPrefix) => {
        const extensionPrefix = "chrome-extension://";
        const selectors = ["iframe", "frame", "embed", "object"];
        const visitedRoots = /* @__PURE__ */ new Set();
        const roots = [document];
        let removed = 0;
        while (roots.length > 0) {
          const root = roots.pop();
          if (!root || visitedRoots.has(root)) continue;
          visitedRoots.add(root);
          for (const selector of selectors) {
            const nodes = root.querySelectorAll(selector);
            for (const node of nodes) {
              const src = node.getAttribute("src") || node.getAttribute("data") || "";
              if (!src.startsWith(extensionPrefix) || src.startsWith(ownExtensionPrefix)) continue;
              node.remove();
              removed++;
            }
          }
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
          let current = walker.nextNode();
          while (current) {
            const element = current;
            if (element.shadowRoot) roots.push(element.shadowRoot);
            current = walker.nextNode();
          }
        }
        return { removed };
      }
    });
    return result?.result ?? { removed: 0 };
  } catch {
    return { removed: 0 };
  }
}
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function tryAttach(tabId) {
  await chrome.debugger.attach({ tabId }, "1.3");
}
async function ensureAttached(tabId, policy = {}) {
  const allowDomCleanup = policy.allowDomCleanup !== false;
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
  try {
    await tryAttach(tabId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const hint = msg.includes("chrome-extension://") ? ". Tip: another Chrome extension may be interfering — try disabling other extensions" : "";
    if (msg.includes("chrome-extension://")) {
      if (!allowDomCleanup) {
        throw new Error(`attach failed: ${msg}${hint}`);
      }
      const recoveryCleanup = await removeForeignExtensionEmbeds(tabId);
      if (recoveryCleanup.removed > 0) {
        console.warn(`[opencli] Removed ${recoveryCleanup.removed} foreign extension frame(s) after attach failure on tab ${tabId}`);
      }
      await delay(ATTACH_RECOVERY_DELAY_MS);
      try {
        await tryAttach(tabId);
      } catch {
        throw new Error(`attach failed: ${msg}${hint}`);
      }
    } else if (msg.includes("Another debugger is already attached")) {
      try {
        await chrome.debugger.detach({ tabId });
      } catch {
      }
      try {
        await tryAttach(tabId);
      } catch {
        throw new Error(`attach failed: ${msg}${hint}`);
      }
    } else {
      throw new Error(`attach failed: ${msg}${hint}`);
    }
  }
  attached.add(tabId);
  try {
    await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
  } catch {
  }
  try {
    await chrome.debugger.sendCommand({ tabId }, "Debugger.enable");
    await chrome.debugger.sendCommand({ tabId }, "Debugger.setBreakpointsActive", { active: false });
  } catch {
  }
}
async function evaluate(tabId, expression, policy) {
  await ensureAttached(tabId, policy);
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
}
const evaluateAsync = evaluate;
async function screenshot(tabId, options = {}, policy) {
  await ensureAttached(tabId, policy);
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
async function setFileInputFiles(tabId, files, selector, policy) {
  await ensureAttached(tabId, policy);
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
async function detach(tabId) {
  if (!attached.has(tabId)) return;
  attached.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
  }
}
function registerListeners() {
  chrome.tabs.onRemoved.addListener((tabId) => {
    attached.delete(tabId);
  });
  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId) attached.delete(source.tabId);
  });
  chrome.tabs.onUpdated.addListener(async (tabId, info) => {
    if (info.url && !isDebuggableUrl$1(info.url)) {
      await detach(tabId);
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
async function getAutomationWindow(workspace) {
  const existing = automationSessions.get(workspace);
  if (existing) {
    try {
      await chrome.windows.get(existing.windowId);
      return existing.windowId;
    } catch {
      automationSessions.delete(workspace);
    }
  }
  const win = await chrome.windows.create({
    url: BLANK_PAGE,
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
  console.log(`[opencli] Created automation window ${session.windowId} (${workspace})`);
  resetWindowIdleTimer(workspace);
  await new Promise((resolve) => setTimeout(resolve, 200));
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
      case "sessions":
        return await handleSessions(cmd);
      case "set-file-input":
        return await handleSetFileInput(cmd, workspace);
      case "bind-current":
        return await handleBindCurrent(cmd, workspace);
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
const BLANK_PAGE = "data:text/html,<html></html>";
function isDebuggableUrl(url) {
  if (!url) return true;
  return url.startsWith("http://") || url.startsWith("https://") || url === BLANK_PAGE;
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
function isNotebooklmWorkspace(workspace) {
  return workspace === "site:notebooklm";
}
function classifyNotebooklmUrl(url) {
  if (!url) return "other";
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "notebooklm.google.com") return "other";
    return parsed.pathname.startsWith("/notebook/") ? "notebook" : "home";
  } catch {
    return "other";
  }
}
function scoreWorkspaceTab(workspace, tab) {
  if (!tab.id || !isDebuggableUrl(tab.url)) return -1;
  if (isNotebooklmWorkspace(workspace)) {
    const kind = classifyNotebooklmUrl(tab.url);
    if (kind === "other") return -1;
    if (kind === "notebook") return tab.active ? 400 : 300;
    return tab.active ? 200 : 100;
  }
  return -1;
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
async function maybeBindWorkspaceToExistingTab(workspace) {
  if (!isNotebooklmWorkspace(workspace)) return null;
  const tabs = await chrome.tabs.query({});
  let bestTab = null;
  let bestScore = -1;
  for (const tab of tabs) {
    const score = scoreWorkspaceTab(workspace, tab);
    if (score > bestScore) {
      bestScore = score;
      bestTab = tab;
    }
  }
  if (!bestTab?.id || bestScore < 0) return null;
  setWorkspaceSession(workspace, {
    windowId: bestTab.windowId,
    owned: false,
    preferredTabId: bestTab.id
  });
  console.log(`[opencli] Workspace ${workspace} bound to existing tab ${bestTab.id} in window ${bestTab.windowId}`);
  resetWindowIdleTimer(workspace);
  return bestTab.id;
}
function getAttachPolicy(target) {
  return { allowDomCleanup: target.owned };
}
async function resolveTabContext(tabId, workspace) {
  if (tabId !== void 0) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const session = automationSessions.get(workspace);
      const matchesSession = session ? session.preferredTabId !== null ? session.preferredTabId === tabId : tab.windowId === session.windowId : false;
      if (isDebuggableUrl(tab.url) && matchesSession) {
        return {
          tabId,
          windowId: tab.windowId,
          owned: session?.owned ?? false
        };
      }
      if (session?.owned && isDebuggableUrl(tab.url)) {
        if (tab.windowId !== session.windowId) {
          console.warn(`[opencli] Tab ${tabId} drifted from window ${session.windowId} to ${tab.windowId}; adopting new window`);
          setWorkspaceSession(workspace, {
            windowId: tab.windowId,
            owned: true,
            preferredTabId: null
          });
        }
        return {
          tabId,
          windowId: tab.windowId,
          owned: true
        };
      }
      if (session && !matchesSession) {
        console.warn(`[opencli] Tab ${tabId} is not bound to workspace ${workspace}, re-resolving`);
      } else if (!isDebuggableUrl(tab.url)) {
        console.warn(`[opencli] Tab ${tabId} URL is not debuggable (${tab.url}), re-resolving`);
      }
    } catch {
      console.warn(`[opencli] Tab ${tabId} no longer exists, re-resolving`);
    }
  }
  const adoptedTabId = await maybeBindWorkspaceToExistingTab(workspace);
  if (adoptedTabId !== null) {
    const adoptedSession = automationSessions.get(workspace);
    if (!adoptedSession) throw new Error(`Workspace ${workspace} lost its session during tab adoption`);
    return {
      tabId: adoptedTabId,
      windowId: adoptedSession.windowId,
      owned: adoptedSession.owned
    };
  }
  const existingSession = automationSessions.get(workspace);
  if (existingSession && existingSession.preferredTabId !== null) {
    try {
      const preferredTabId = existingSession.preferredTabId;
      const preferredTab = await chrome.tabs.get(preferredTabId);
      if (isDebuggableUrl(preferredTab.url)) {
        return {
          tabId: preferredTab.id,
          windowId: preferredTab.windowId,
          owned: existingSession.owned
        };
      }
    } catch {
      automationSessions.delete(workspace);
    }
  }
  const windowId = await getAutomationWindow(workspace);
  const tabs = await chrome.tabs.query({ windowId });
  const debuggableTab = tabs.find((t) => t.id && isDebuggableUrl(t.url));
  if (debuggableTab?.id) {
    return {
      tabId: debuggableTab.id,
      windowId,
      owned: true
    };
  }
  const reuseTab = tabs.find((t) => t.id);
  if (reuseTab?.id) {
    await chrome.tabs.update(reuseTab.id, { url: BLANK_PAGE });
    await new Promise((resolve) => setTimeout(resolve, 300));
    try {
      const updated = await chrome.tabs.get(reuseTab.id);
      if (isDebuggableUrl(updated.url)) {
        return {
          tabId: reuseTab.id,
          windowId,
          owned: true
        };
      }
      console.warn(`[opencli] data: URI was intercepted (${updated.url}), creating fresh tab`);
    } catch {
    }
  }
  const newTab = await chrome.tabs.create({ windowId, url: BLANK_PAGE, active: true });
  if (!newTab.id) throw new Error("Failed to create tab in automation window");
  return {
    tabId: newTab.id,
    windowId,
    owned: true
  };
}
async function resolveTabId(tabId, workspace) {
  return (await resolveTabContext(tabId, workspace)).tabId;
}
async function waitForNavigationComplete(tabId, targetUrl, beforeNormalized) {
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
      if (beforeNormalized === void 0) return isTargetUrl(url, targetUrl);
      return isTargetUrl(url, targetUrl) || normalizeUrlForComparison(url) !== beforeNormalized;
    };
    const listener = (id, info, tab) => {
      if (id !== tabId) return;
      if (info.status === "complete" && isNavigationDone(tab.url ?? info.url)) {
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
  return { timedOut };
}
async function recoverOwnedNavigationTarget(workspace, targetUrl) {
  const session = automationSessions.get(workspace);
  if (!session?.owned) return null;
  const tabs = await chrome.tabs.query({ windowId: session.windowId });
  const matchingTab = tabs.find((tab) => tab.id && isDebuggableUrl(tab.url) && isTargetUrl(tab.url, targetUrl));
  if (matchingTab?.id) {
    return {
      tabId: matchingTab.id,
      windowId: matchingTab.windowId,
      owned: true
    };
  }
  const newTab = await chrome.tabs.create({ windowId: session.windowId, url: targetUrl, active: true });
  if (!newTab.id) return null;
  await waitForNavigationComplete(newTab.id, targetUrl);
  const currentTab = await chrome.tabs.get(newTab.id);
  return {
    tabId: newTab.id,
    windowId: currentTab.windowId,
    owned: true
  };
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
  const target = await resolveTabContext(cmd.tabId, workspace);
  try {
    const data = await evaluateAsync(target.tabId, cmd.code, getAttachPolicy(target));
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
  let target = await resolveTabContext(cmd.tabId, workspace);
  const beforeTab = await chrome.tabs.get(target.tabId);
  const beforeNormalized = normalizeUrlForComparison(beforeTab.url);
  const targetUrl = cmd.url;
  if (beforeTab.status === "complete" && isTargetUrl(beforeTab.url, targetUrl)) {
    return {
      id: cmd.id,
      ok: true,
      data: { title: beforeTab.title, url: beforeTab.url, tabId: target.tabId, timedOut: false }
    };
  }
  await detach(target.tabId);
  await chrome.tabs.update(target.tabId, { url: targetUrl });
  let { timedOut } = await waitForNavigationComplete(target.tabId, targetUrl, beforeNormalized);
  let tab = await chrome.tabs.get(target.tabId);
  if (!isDebuggableUrl(tab.url) && target.owned) {
    console.warn(`[opencli] Owned tab ${target.tabId} ended on non-debuggable URL (${tab.url}), attempting recovery`);
    const recoveredTarget = await recoverOwnedNavigationTarget(workspace, targetUrl);
    if (recoveredTarget) {
      target = recoveredTarget;
      tab = await chrome.tabs.get(target.tabId);
      timedOut = timedOut || !isTargetUrl(tab.url, targetUrl);
    }
  }
  return {
    id: cmd.id,
    ok: true,
    data: { title: tab.title, url: tab.url, tabId: target.tabId, timedOut }
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
  const target = await resolveTabContext(cmd.tabId, workspace);
  try {
    const data = await screenshot(target.tabId, {
      format: cmd.format,
      quality: cmd.quality,
      fullPage: cmd.fullPage
    }, getAttachPolicy(target));
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
  const target = await resolveTabContext(cmd.tabId, workspace);
  try {
    await setFileInputFiles(target.tabId, cmd.files, cmd.selector, getAttachPolicy(target));
    return { id: cmd.id, ok: true, data: { count: cmd.files.length } };
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
