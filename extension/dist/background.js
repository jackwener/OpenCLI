const DAEMON_PORT = 19825;
const DAEMON_HOST = "localhost";
const DAEMON_WS_URL = `ws://${DAEMON_HOST}:${DAEMON_PORT}/ext`;
const DAEMON_PING_URL = `http://${DAEMON_HOST}:${DAEMON_PORT}/ping`;
const WS_RECONNECT_BASE_DELAY = 2e3;
const WS_RECONNECT_MAX_DELAY = 5e3;

const attached = /* @__PURE__ */ new Set();
const tabFrameContexts = /* @__PURE__ */ new Map();
const frameTargets = /* @__PURE__ */ new Map();
const frameTargetKeys = /* @__PURE__ */ new Map();
let frameTargetCleanupRegistered = false;
const CDP_RESPONSE_BODY_CAPTURE_LIMIT = 8 * 1024 * 1024;
const CDP_REQUEST_BODY_CAPTURE_LIMIT = 1 * 1024 * 1024;
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
  const fullPage = options.fullPage === true;
  const overrideWidth = options.width && options.width > 0 ? Math.ceil(options.width) : void 0;
  const overrideHeight = !fullPage && options.height && options.height > 0 ? Math.ceil(options.height) : void 0;
  const needsOverride = fullPage || overrideWidth !== void 0 || overrideHeight !== void 0;
  if (needsOverride) {
    if (overrideWidth !== void 0 && fullPage) {
      await chrome.debugger.sendCommand({ tabId }, "Emulation.setDeviceMetricsOverride", {
        mobile: false,
        width: overrideWidth,
        height: 0,
        deviceScaleFactor: 1
      });
    }
    let finalWidth = overrideWidth ?? 0;
    let finalHeight = overrideHeight ?? 0;
    if (fullPage) {
      const metrics = await chrome.debugger.sendCommand({ tabId }, "Page.getLayoutMetrics");
      const size = metrics.cssContentSize || metrics.contentSize;
      if (size) {
        if (finalWidth === 0) finalWidth = Math.ceil(size.width);
        finalHeight = Math.ceil(size.height);
      }
    }
    await chrome.debugger.sendCommand({ tabId }, "Emulation.setDeviceMetricsOverride", {
      mobile: false,
      width: finalWidth,
      height: finalHeight,
      deviceScaleFactor: 1
    });
  }
  try {
    const params = { format };
    if (format === "jpeg" && options.quality !== void 0) {
      params.quality = Math.max(0, Math.min(100, options.quality));
    }
    const result = await chrome.debugger.sendCommand({ tabId }, "Page.captureScreenshot", params);
    return result.data;
  } finally {
    if (needsOverride) {
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
function matchesDownloadPattern(item, pattern) {
  if (!pattern) return true;
  const haystack = [
    item.filename,
    item.url,
    item.finalUrl,
    item.mime
  ].filter(Boolean).join("\n").toLowerCase();
  return haystack.includes(pattern.toLowerCase());
}
function downloadResult(item, startedAt) {
  return {
    downloaded: item.state === "complete",
    id: item.id,
    filename: item.filename,
    url: item.url,
    finalUrl: item.finalUrl,
    mime: item.mime,
    totalBytes: item.totalBytes,
    state: item.state,
    danger: item.danger,
    error: item.error,
    elapsedMs: Date.now() - startedAt
  };
}
async function waitForDownload(pattern = "", timeoutMs = 3e4) {
  const startedAt = Date.now();
  const timeout = Math.max(1, timeoutMs);
  return await new Promise((resolve) => {
    let done = false;
    const inProgressIds = /* @__PURE__ */ new Set();
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.downloads.onCreated.removeListener(onCreated);
      chrome.downloads.onChanged.removeListener(onChanged);
      resolve(result);
    };
    const inspectById = async (id) => {
      const items = await chrome.downloads.search({ id });
      const item = items[0];
      if (!item || !matchesDownloadPattern(item, pattern)) return;
      inProgressIds.add(id);
      if (item.state === "complete" || item.state === "interrupted") finish(downloadResult(item, startedAt));
    };
    const onCreated = (item) => {
      if (!matchesDownloadPattern(item, pattern)) return;
      inProgressIds.add(item.id);
      if (item.state === "complete" || item.state === "interrupted") finish(downloadResult(item, startedAt));
    };
    const onChanged = (delta) => {
      if (!delta.id) return;
      if (!inProgressIds.has(delta.id) && !delta.filename && !delta.url) return;
      if (delta.filename?.current || delta.url?.current) {
        void inspectById(delta.id);
        return;
      }
      if (delta.state?.current === "complete" || delta.state?.current === "interrupted") {
        void inspectById(delta.id);
      }
    };
    const timer = setTimeout(() => {
      finish({
        downloaded: false,
        state: "interrupted",
        error: `No download matched "${pattern || "*"}" within ${timeout}ms`,
        elapsedMs: Date.now() - startedAt
      });
    }, timeout);
    chrome.downloads.onCreated.addListener(onCreated);
    chrome.downloads.onChanged.addListener(onChanged);
    void chrome.downloads.search({
      limit: 50,
      orderBy: ["-startTime"],
      startedAfter: new Date(startedAt - Math.max(timeout, 1e3)).toISOString()
    }).then((recent) => {
      if (done) return;
      const completed = recent.find((item) => item.state === "complete" && matchesDownloadPattern(item, pattern));
      if (completed) {
        finish(downloadResult(completed, startedAt));
        return;
      }
      for (const item of recent) {
        if (item.state === "in_progress" && matchesDownloadPattern(item, pattern)) inProgressIds.add(item.id);
      }
    }).catch((err) => {
      finish({
        downloaded: false,
        state: "interrupted",
        error: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - startedAt
      });
    });
  });
}
function frameTargetKey(tabId, frameId) {
  return `${tabId}:${frameId}`;
}
function registerFrameTargetCleanup() {
  if (frameTargetCleanupRegistered) return;
  frameTargetCleanupRegistered = true;
  chrome.debugger.onEvent.addListener((_source, method, params) => {
    if (method === "Target.detachedFromTarget") {
      const targetId = String(params?.targetId || "");
      clearFrameTarget(targetId);
    }
  });
}
function clearFrameTarget(targetId) {
  if (!targetId) return;
  const key = frameTargetKeys.get(targetId);
  if (key) frameTargets.delete(key);
  frameTargetKeys.delete(targetId);
}
async function ensureFrameTarget(tabId, frameId, aggressiveRetry = false, targetUrl) {
  registerFrameTargetCleanup();
  await ensureAttached(tabId, aggressiveRetry);
  const key = frameTargetKey(tabId, frameId);
  const existing = frameTargets.get(key);
  if (existing) return existing;
  await chrome.debugger.sendCommand({ tabId }, "Target.setDiscoverTargets", { discover: true }).catch(() => {
  });
  await chrome.debugger.sendCommand({ tabId }, "Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
    filter: [{ type: "iframe", exclude: false }]
  }).catch(() => {
  });
  const targetId = await resolveFrameTargetId(tabId, frameId, targetUrl);
  try {
    await chrome.debugger.attach({ targetId }, "1.3");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("Another debugger is already attached")) throw err;
  }
  frameTargets.set(key, targetId);
  frameTargetKeys.set(targetId, key);
  return targetId;
}
async function resolveFrameTargetId(tabId, frameId, targetUrl) {
  const result = await chrome.debugger.sendCommand({ tabId }, "Target.getTargets").catch(() => null);
  const targets = result?.targetInfos ?? [];
  const frameTarget = targets.find((candidate) => {
    const candidateId = candidate.targetId || candidate.id;
    return candidate.type === "iframe" && (candidateId === frameId || !!targetUrl && candidate.url === targetUrl);
  });
  const targetId = frameTarget?.targetId || frameTarget?.id;
  if (targetId) return targetId;
  const candidates = targets.filter((target) => target.type === "iframe").map((target) => `${target.targetId || target.id || "?"} ${target.url || ""}`).join("; ");
  throw new Error(`No iframe target found for frame ${frameId}${targetUrl ? ` (${targetUrl})` : ""}. Candidates: ${candidates || "none"}`);
}
async function sendCommandInFrameTarget(tabId, frameId, method, params = {}, aggressiveRetry = false, _timeoutMs = 3e4, targetUrl) {
  const targetId = await ensureFrameTarget(tabId, frameId, aggressiveRetry, targetUrl);
  const target = { targetId };
  return chrome.debugger.sendCommand(target, method, params);
}
async function insertText(tabId, text) {
  await ensureAttached(tabId);
  await chrome.debugger.sendCommand({ tabId }, "Input.insertText", { text });
}
function registerFrameTracking() {
  registerFrameTargetCleanup();
  chrome.debugger.onEvent.addListener((source, method, params) => {
    const tabId = source.tabId;
    if (!tabId) return;
    if (method === "Runtime.executionContextCreated") {
      const context = params.context;
      if (!context?.auxData?.frameId || context.auxData.isDefault !== true) return;
      const frameId = context.auxData.frameId;
      if (!tabFrameContexts.has(tabId)) {
        tabFrameContexts.set(tabId, /* @__PURE__ */ new Map());
      }
      tabFrameContexts.get(tabId).set(frameId, context.id);
    }
    if (method === "Runtime.executionContextDestroyed") {
      const ctxId = params.executionContextId;
      const contexts = tabFrameContexts.get(tabId);
      if (contexts) {
        for (const [fid, cid] of contexts) {
          if (cid === ctxId) {
            contexts.delete(fid);
            break;
          }
        }
      }
    }
    if (method === "Runtime.executionContextsCleared") {
      tabFrameContexts.delete(tabId);
    }
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    tabFrameContexts.delete(tabId);
  });
}
async function getFrameTree(tabId) {
  await ensureAttached(tabId);
  return chrome.debugger.sendCommand({ tabId }, "Page.getFrameTree");
}
async function evaluateInFrame(tabId, expression, frameId, aggressiveRetry = false) {
  await ensureAttached(tabId, aggressiveRetry);
  await chrome.debugger.sendCommand({ tabId }, "Runtime.enable").catch(() => {
  });
  const contexts = tabFrameContexts.get(tabId);
  const contextId = contexts?.get(frameId);
  if (contextId === void 0) {
    await sendCommandInFrameTarget(tabId, frameId, "Runtime.enable", {}, aggressiveRetry).catch(() => void 0);
    const result2 = await sendCommandInFrameTarget(tabId, frameId, "Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true
    }, aggressiveRetry);
    if (result2.exceptionDetails) {
      const errMsg = result2.exceptionDetails.exception?.description || result2.exceptionDetails.text || "Eval error";
      throw new Error(errMsg);
    }
    return result2.result?.value;
  }
  const result = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
    expression,
    contextId,
    returnByValue: true,
    awaitPromise: true
  });
  if (result.exceptionDetails) {
    const errMsg = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Eval error";
    throw new Error(errMsg);
  }
  return result.result?.value;
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
function hasActiveNetworkCapture(tabId) {
  return networkCaptures.has(tabId);
}
function clearFrameTargetsForTab(tabId) {
  for (const [key, targetId] of [...frameTargets.entries()]) {
    if (!key.startsWith(`${tabId}:`)) continue;
    frameTargets.delete(key);
    frameTargetKeys.delete(targetId);
    chrome.debugger.detach({ targetId }).catch(() => {
    });
  }
}
async function detach(tabId) {
  clearFrameTargetsForTab(tabId);
  if (!attached.has(tabId)) return;
  attached.delete(tabId);
  networkCaptures.delete(tabId);
  tabFrameContexts.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
  }
}
function registerListeners() {
  chrome.tabs.onRemoved.addListener((tabId) => {
    attached.delete(tabId);
    networkCaptures.delete(tabId);
    tabFrameContexts.delete(tabId);
    clearFrameTargetsForTab(tabId);
  });
  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId) {
      attached.delete(source.tabId);
      networkCaptures.delete(source.tabId);
      tabFrameContexts.delete(source.tabId);
      clearFrameTargetsForTab(source.tabId);
      return;
    }
    if (source.targetId) clearFrameTarget(source.targetId);
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
    const eventParams = params;
    if (method === "Network.requestWillBeSent") {
      const requestId = String(eventParams?.requestId || "");
      const request = eventParams?.request;
      const entry = getOrCreateNetworkCaptureEntry(tabId, requestId, {
        url: request?.url,
        method: request?.method,
        requestHeaders: normalizeHeaders(request?.headers)
      });
      if (!entry) return;
      entry.requestBodyKind = request?.hasPostData ? "string" : "empty";
      {
        const raw = String(request?.postData || "");
        const fullSize = raw.length;
        const truncated = fullSize > CDP_REQUEST_BODY_CAPTURE_LIMIT;
        entry.requestBodyPreview = truncated ? raw.slice(0, CDP_REQUEST_BODY_CAPTURE_LIMIT) : raw;
        entry.requestBodyFullSize = fullSize;
        entry.requestBodyTruncated = truncated;
      }
      try {
        const postData = await chrome.debugger.sendCommand({ tabId }, "Network.getRequestPostData", { requestId });
        if (postData?.postData) {
          const raw = postData.postData;
          const fullSize = raw.length;
          const truncated = fullSize > CDP_REQUEST_BODY_CAPTURE_LIMIT;
          entry.requestBodyKind = "string";
          entry.requestBodyPreview = truncated ? raw.slice(0, CDP_REQUEST_BODY_CAPTURE_LIMIT) : raw;
          entry.requestBodyFullSize = fullSize;
          entry.requestBodyTruncated = truncated;
        }
      } catch {
      }
      return;
    }
    if (method === "Network.responseReceived") {
      const requestId = String(eventParams?.requestId || "");
      const response = eventParams?.response;
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
      const requestId = String(eventParams?.requestId || "");
      const stateEntryIndex = state.requestToIndex.get(requestId);
      if (stateEntryIndex === void 0) return;
      const entry = state.entries[stateEntryIndex];
      if (!entry) return;
      try {
        const body = await chrome.debugger.sendCommand({ tabId }, "Network.getResponseBody", { requestId });
        if (typeof body?.body === "string") {
          const fullSize = body.body.length;
          const truncated = fullSize > CDP_RESPONSE_BODY_CAPTURE_LIMIT;
          const stored = truncated ? body.body.slice(0, CDP_RESPONSE_BODY_CAPTURE_LIMIT) : body.body;
          entry.responsePreview = body.base64Encoded ? `base64:${stored}` : stored;
          entry.responseBodyFullSize = fullSize;
          entry.responseBodyTruncated = truncated;
        }
      } catch {
      }
    }
  });
}

const targetToTab = /* @__PURE__ */ new Map();
const tabToTarget = /* @__PURE__ */ new Map();
async function resolveTargetId(tabId) {
  const cached = tabToTarget.get(tabId);
  if (cached) return cached;
  await refreshMappings();
  const result = tabToTarget.get(tabId);
  if (!result) throw new Error(`No targetId for tab ${tabId} — page may have been closed`);
  return result;
}
async function resolveTabId$1(targetId) {
  const cached = targetToTab.get(targetId);
  if (cached !== void 0) return cached;
  await refreshMappings();
  const result = targetToTab.get(targetId);
  if (result === void 0) throw new Error(`Page not found: ${targetId} — stale page identity`);
  return result;
}
function evictTab(tabId) {
  const targetId = tabToTarget.get(tabId);
  if (targetId) targetToTab.delete(targetId);
  tabToTarget.delete(tabId);
}
async function refreshMappings() {
  const targets = await chrome.debugger.getTargets();
  targetToTab.clear();
  tabToTarget.clear();
  for (const t of targets) {
    if (t.type === "page" && t.tabId !== void 0) {
      targetToTab.set(t.id, t.tabId);
      tabToTarget.set(t.tabId, t.id);
    }
  }
}

let ws = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
const CONTEXT_ID_KEY = "opencli_context_id_v1";
let currentContextId = "default";
let contextIdPromise = null;
let connectInFlight = null;
async function getCurrentContextId() {
  if (contextIdPromise) return contextIdPromise;
  contextIdPromise = (async () => {
    try {
      const local = chrome.storage?.local;
      if (!local) return currentContextId;
      const raw = await local.get(CONTEXT_ID_KEY);
      const existing = raw[CONTEXT_ID_KEY];
      if (typeof existing === "string" && existing.trim()) {
        currentContextId = existing.trim();
        return currentContextId;
      }
      const generated = generateContextId();
      await local.set({ [CONTEXT_ID_KEY]: generated });
      currentContextId = generated;
      return currentContextId;
    } catch {
      return currentContextId;
    }
  })();
  return contextIdPromise;
}
function generateContextId() {
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
  const maxUnbiasedByte = Math.floor(256 / alphabet.length) * alphabet.length;
  let id = "";
  while (id.length < 8) {
    const bytes = new Uint8Array(8);
    try {
      crypto.getRandomValues(bytes);
    } catch {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    for (const byte of bytes) {
      if (byte >= maxUnbiasedByte) continue;
      id += alphabet[byte % alphabet.length];
      if (id.length === 8) break;
    }
  }
  return id;
}
const _origLog = console.log.bind(console);
const _origWarn = console.warn.bind(console);
const _origError = console.error.bind(console);
function forwardLog(level, args) {
  try {
    const msg = args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
    safeSend(ws, { type: "log", level, msg, ts: Date.now() });
  } catch {
  }
}
function safeSend(socket, payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  try {
    socket.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
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
function isDaemonSocketActive(socket = ws) {
  return socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING;
}
function connect() {
  if (isDaemonSocketActive()) return Promise.resolve();
  if (connectInFlight) return connectInFlight;
  connectInFlight = connectAttempt().finally(() => {
    connectInFlight = null;
  });
  return connectInFlight;
}
async function connectAttempt() {
  if (isDaemonSocketActive()) return;
  try {
    const res = await fetch(DAEMON_PING_URL, { signal: AbortSignal.timeout(1e3) });
    if (!res.ok) return;
  } catch {
    return;
  }
  if (isDaemonSocketActive()) return;
  let thisWs;
  try {
    const contextId = await getCurrentContextId();
    if (isDaemonSocketActive()) return;
    thisWs = new WebSocket(DAEMON_WS_URL);
    ws = thisWs;
    currentContextId = contextId;
  } catch {
    scheduleReconnect();
    return;
  }
  thisWs.onopen = () => {
    if (ws !== thisWs) return;
    console.log("[opencli] Connected to daemon");
    reconnectAttempts = 0;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    safeSend(thisWs, {
      type: "hello",
      contextId: currentContextId,
      version: chrome.runtime.getManifest().version,
      compatRange: ">=1.7.0"
    });
  };
  thisWs.onmessage = async (event) => {
    if (ws !== thisWs) return;
    try {
      const command = JSON.parse(event.data);
      const result = await handleCommand(command);
      if (ws !== thisWs) return;
      safeSend(thisWs, result);
    } catch (err) {
      console.error("[opencli] Message handling error:", err);
    }
  };
  thisWs.onclose = () => {
    if (ws !== thisWs) return;
    console.log("[opencli] Disconnected from daemon");
    ws = null;
    scheduleReconnect();
  };
  thisWs.onerror = () => {
    thisWs.close();
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
const IDLE_TIMEOUT_DEFAULT = 3e4;
const IDLE_TIMEOUT_INTERACTIVE = 6e5;
const IDLE_TIMEOUT_NONE = -1;
const REGISTRY_KEY = "opencli_target_lease_registry_v2";
const LEASE_IDLE_ALARM_PREFIX = "opencli:lease-idle:";
const CONTAINER_TAB_GROUP_TITLE = {
  interactive: "OpenCLI Browser",
  automation: "OpenCLI Adapter"
};
const LEGACY_AUTOMATION_TAB_GROUP_TITLE = "OpenCLI";
const AUTOMATION_TAB_GROUP_COLOR = "orange";
let leaseMutationQueue = Promise.resolve();
const ownedContainers = {
  interactive: { windowId: null, groupId: null, promise: null },
  automation: { windowId: null, groupId: null, promise: null }
};
class CommandFailure extends Error {
  constructor(code, message, hint) {
    super(message);
    this.code = code;
    this.hint = hint;
    this.name = "CommandFailure";
  }
}
const sessionTimeoutOverrides = /* @__PURE__ */ new Map();
const sessionWindowModeOverrides = /* @__PURE__ */ new Map();
const sessionLifecycleOverrides = /* @__PURE__ */ new Map();
const LEASE_KEY_SEPARATOR = "\0";
function getLeaseKey(session, surface) {
  return `${surface}${LEASE_KEY_SEPARATOR}${encodeURIComponent(session)}`;
}
function getSessionName(session) {
  const raw = session?.trim();
  if (!raw) throw new CommandFailure(
    "session_required",
    "Browser session is required.",
    "Pass a browser session name, e.g. opencli browser <session> <command>."
  );
  return raw;
}
function getCommandSurface(cmd) {
  return cmd.surface === "adapter" ? "adapter" : "browser";
}
function getSurfaceFromKey(key) {
  return key.split(LEASE_KEY_SEPARATOR, 1)[0] === "adapter" ? "adapter" : "browser";
}
function getSessionFromKey(key) {
  const idx = key.indexOf(LEASE_KEY_SEPARATOR);
  if (idx === -1) return key;
  try {
    return decodeURIComponent(key.slice(idx + 1));
  } catch {
    return key.slice(idx + 1);
  }
}
function getIdleTimeout(key) {
  const session = automationSessions.get(key);
  if (session?.kind === "bound") return IDLE_TIMEOUT_NONE;
  const adapterPersistent = getSurfaceFromKey(key) === "adapter" && (session?.lifecycle === "persistent" || sessionLifecycleOverrides.get(key) === "persistent");
  if (adapterPersistent) return IDLE_TIMEOUT_NONE;
  const override = sessionTimeoutOverrides.get(key);
  if (override !== void 0) return override;
  return getSurfaceFromKey(key) === "browser" ? IDLE_TIMEOUT_INTERACTIVE : IDLE_TIMEOUT_DEFAULT;
}
function getLeaseLifecycle(key, kind) {
  if (kind === "bound") return "pinned";
  const override = sessionLifecycleOverrides.get(key);
  if (override) return override;
  return getSurfaceFromKey(key) === "browser" ? "persistent" : "ephemeral";
}
function getOwnedWindowRole(key) {
  return getSurfaceFromKey(key) === "browser" ? "interactive" : "automation";
}
function getWindowRole(key, ownership) {
  return ownership === "borrowed" ? "borrowed-user" : getOwnedWindowRole(key);
}
function getWindowMode(key) {
  return sessionWindowModeOverrides.get(key) ?? (getOwnedWindowRole(key) === "interactive" ? "foreground" : "background");
}
function makeAlarmName(leaseKey) {
  return `${LEASE_IDLE_ALARM_PREFIX}${encodeURIComponent(leaseKey)}`;
}
function leaseKeyFromAlarmName(name) {
  if (!name.startsWith(LEASE_IDLE_ALARM_PREFIX)) return null;
  try {
    return decodeURIComponent(name.slice(LEASE_IDLE_ALARM_PREFIX.length));
  } catch {
    return null;
  }
}
function withLeaseMutation(fn) {
  const run = leaseMutationQueue.then(fn, fn);
  leaseMutationQueue = run.then(() => void 0, () => void 0);
  return run;
}
function makeSession(key, session) {
  const ownership = session.owned ? "owned" : "borrowed";
  return {
    ...session,
    contextId: currentContextId,
    ownership,
    lifecycle: getLeaseLifecycle(key, session.kind),
    windowRole: getWindowRole(key, ownership)
  };
}
function emptyRegistry() {
  return {
    version: 2,
    contextId: currentContextId,
    ownedContainers: {
      interactive: {
        windowId: ownedContainers.interactive.windowId,
        groupId: ownedContainers.interactive.groupId
      },
      automation: {
        windowId: ownedContainers.automation.windowId,
        groupId: ownedContainers.automation.groupId
      }
    },
    leases: {}
  };
}
async function readRegistry() {
  try {
    const local = chrome.storage?.local;
    if (!local) return emptyRegistry();
    const raw = await local.get(REGISTRY_KEY);
    const stored = raw[REGISTRY_KEY];
    if (!stored || stored.version !== 2 || typeof stored.leases !== "object") return emptyRegistry();
    const storedContainers = stored.ownedContainers && typeof stored.ownedContainers === "object" ? stored.ownedContainers : emptyRegistry().ownedContainers;
    return {
      version: 2,
      contextId: currentContextId,
      ownedContainers: {
        interactive: {
          windowId: typeof storedContainers.interactive?.windowId === "number" ? storedContainers.interactive.windowId : null,
          groupId: typeof storedContainers.interactive?.groupId === "number" ? storedContainers.interactive.groupId : null
        },
        automation: {
          windowId: typeof storedContainers.automation?.windowId === "number" ? storedContainers.automation.windowId : null,
          groupId: typeof storedContainers.automation?.groupId === "number" ? storedContainers.automation.groupId : null
        }
      },
      leases: stored.leases
    };
  } catch {
    return emptyRegistry();
  }
}
async function writeRegistry(registry) {
  try {
    await chrome.storage?.local?.set({ [REGISTRY_KEY]: registry });
  } catch {
  }
}
async function persistRuntimeState() {
  const leases = {};
  for (const [leaseKey, session] of automationSessions.entries()) {
    leases[leaseKey] = {
      session: session.session,
      surface: session.surface,
      kind: session.kind,
      windowId: session.windowId,
      owned: session.owned,
      preferredTabId: session.preferredTabId,
      contextId: session.contextId,
      ownership: session.ownership,
      lifecycle: session.lifecycle,
      windowRole: session.windowRole,
      idleDeadlineAt: session.idleDeadlineAt,
      updatedAt: Date.now()
    };
  }
  await writeRegistry({
    version: 2,
    contextId: currentContextId,
    ownedContainers: {
      interactive: {
        windowId: ownedContainers.interactive.windowId,
        groupId: ownedContainers.interactive.groupId
      },
      automation: {
        windowId: ownedContainers.automation.windowId,
        groupId: ownedContainers.automation.groupId
      }
    },
    leases
  });
}
function scheduleIdleAlarm(leaseKey, timeout) {
  const alarmName = makeAlarmName(leaseKey);
  try {
    if (timeout > 0) {
      chrome.alarms?.create?.(alarmName, { when: Date.now() + timeout });
    } else {
      chrome.alarms?.clear?.(alarmName);
    }
  } catch {
  }
}
async function safeDetach(tabId) {
  try {
    const detach$1 = detach;
    if (typeof detach$1 === "function") await detach$1(tabId);
  } catch {
  }
}
async function removeLeaseSession(leaseKey) {
  const existing = automationSessions.get(leaseKey);
  if (existing?.idleTimer) clearTimeout(existing.idleTimer);
  automationSessions.delete(leaseKey);
  sessionTimeoutOverrides.delete(leaseKey);
  sessionWindowModeOverrides.delete(leaseKey);
  sessionLifecycleOverrides.delete(leaseKey);
  scheduleIdleAlarm(leaseKey, IDLE_TIMEOUT_NONE);
  await persistRuntimeState();
}
function resetWindowIdleTimer(leaseKey) {
  const session = automationSessions.get(leaseKey);
  if (!session) return;
  if (session.idleTimer) clearTimeout(session.idleTimer);
  const timeout = getIdleTimeout(leaseKey);
  scheduleIdleAlarm(leaseKey, timeout);
  if (timeout <= 0) {
    session.idleTimer = null;
    session.idleDeadlineAt = 0;
    void persistRuntimeState();
    return;
  }
  session.idleDeadlineAt = Date.now() + timeout;
  void persistRuntimeState();
  session.idleTimer = setTimeout(async () => {
    await releaseLease(leaseKey, "idle timeout");
  }, timeout);
}
async function getOwnedContainerGroupId(role, windowId) {
  const container = ownedContainers[role];
  if (container.groupId !== null) {
    try {
      const group = await chrome.tabGroups.get(container.groupId);
      if (group.windowId === windowId) return container.groupId;
    } catch {
    }
    container.groupId = null;
  }
  for (const title of getOwnedContainerGroupTitles(role)) {
    const groups = await chrome.tabGroups.query({ windowId, title });
    const existing = groups[0];
    if (existing) {
      container.groupId = existing.id;
      return existing.id;
    }
  }
  return null;
}
function getOwnedContainerGroupTitles(role) {
  return role === "automation" ? [CONTAINER_TAB_GROUP_TITLE.automation, LEGACY_AUTOMATION_TAB_GROUP_TITLE] : [CONTAINER_TAB_GROUP_TITLE.interactive];
}
async function focusOwnedWindowIfRequested(windowId, mode) {
  if (mode !== "foreground") return;
  const updateWindow = chrome.windows.update;
  if (typeof updateWindow === "function") await updateWindow(windowId, { focused: true }).catch(() => {
  });
}
async function toOwnedContainerDiscoveryCandidate(group) {
  try {
    const chromeWindow = await chrome.windows.get(group.windowId);
    const reusableTabId = await findReusableOwnedContainerTab(group.windowId);
    return {
      windowId: group.windowId,
      groupId: group.id,
      focused: !!chromeWindow.focused,
      hasReusableTab: reusableTabId !== void 0
    };
  } catch {
    return null;
  }
}
function selectOwnedContainerDiscoveryCandidate(candidates) {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    if (a.focused !== b.focused) return a.focused ? -1 : 1;
    if (a.hasReusableTab !== b.hasReusableTab) return a.hasReusableTab ? -1 : 1;
    return a.groupId - b.groupId;
  })[0];
}
async function discoverOwnedContainerFromTabGroup(role) {
  const container = ownedContainers[role];
  if (container.groupId !== null) {
    try {
      const group = await chrome.tabGroups.get(container.groupId);
      await chrome.windows.get(group.windowId);
      container.windowId = group.windowId;
      return { windowId: group.windowId, groupId: group.id };
    } catch {
      container.windowId = null;
      container.groupId = null;
    }
  }
  for (const title of getOwnedContainerGroupTitles(role)) {
    const groups = await chrome.tabGroups.query({ title });
    const candidates = (await Promise.all(groups.map(toOwnedContainerDiscoveryCandidate))).filter((candidate) => candidate !== null);
    const selected = selectOwnedContainerDiscoveryCandidate(candidates);
    if (!selected) continue;
    container.windowId = selected.windowId;
    container.groupId = selected.groupId;
    return { windowId: selected.windowId, groupId: selected.groupId };
  }
  return null;
}
async function ensureOwnedContainerTabGroup(role, windowId, tabIds) {
  const ids = [...new Set(tabIds.filter((id) => id !== void 0))];
  if (ids.length === 0) return;
  try {
    const existingGroupId = await getOwnedContainerGroupId(role, windowId);
    if (existingGroupId !== null) {
      const tabs = await chrome.tabs.query({ windowId });
      const alreadyGrouped = new Set(
        tabs.filter((tab) => tab.id !== void 0 && ids.includes(tab.id) && tab.groupId === existingGroupId).map((tab) => tab.id)
      );
      const missing = ids.filter((id) => !alreadyGrouped.has(id));
      if (missing.length > 0) await chrome.tabs.group({ groupId: existingGroupId, tabIds: missing });
      return;
    }
    const groupId = await chrome.tabs.group({ tabIds: ids, createProperties: { windowId } });
    ownedContainers[role].groupId = groupId;
    await chrome.tabGroups.update(groupId, {
      color: AUTOMATION_TAB_GROUP_COLOR,
      title: CONTAINER_TAB_GROUP_TITLE[role],
      collapsed: false
    });
  } catch (err) {
    console.warn(`[opencli] Failed to mark ${role} tab group: ${err instanceof Error ? err.message : String(err)}`);
  }
}
async function ensureOwnedContainerWindow(role, initialUrl, mode = "background") {
  const container = ownedContainers[role];
  if (container.promise) return container.promise;
  container.promise = ensureOwnedContainerWindowUnlocked(role, initialUrl, mode).finally(() => {
    container.promise = null;
  });
  return container.promise;
}
async function ensureOwnedContainerWindowUnlocked(role, initialUrl, mode = "background") {
  const container = ownedContainers[role];
  if (container.windowId !== null) {
    try {
      await chrome.windows.get(container.windowId);
      await focusOwnedWindowIfRequested(container.windowId, mode);
      const initialTabId2 = await findReusableOwnedContainerTab(container.windowId);
      await ensureOwnedContainerTabGroup(role, container.windowId, [initialTabId2]);
      return {
        windowId: container.windowId,
        initialTabId: initialTabId2
      };
    } catch {
      container.windowId = null;
      container.groupId = null;
    }
  }
  const discovered = await discoverOwnedContainerFromTabGroup(role);
  if (discovered) {
    await focusOwnedWindowIfRequested(discovered.windowId, mode);
    const initialTabId2 = await findReusableOwnedContainerTab(discovered.windowId);
    await ensureOwnedContainerTabGroup(role, discovered.windowId, [initialTabId2]);
    await persistRuntimeState();
    return {
      windowId: discovered.windowId,
      initialTabId: initialTabId2
    };
  }
  const startUrl = initialUrl && isSafeNavigationUrl(initialUrl) ? initialUrl : BLANK_PAGE;
  const win = await chrome.windows.create({
    url: startUrl,
    focused: mode === "foreground",
    width: 1280,
    height: 900,
    type: "normal"
  });
  container.windowId = win.id;
  console.log(`[opencli] Created owned ${role} window ${container.windowId} (start=${startUrl})`);
  const tabs = await chrome.tabs.query({ windowId: win.id });
  const initialTabId = tabs[0]?.id;
  if (initialTabId) {
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 500);
      const listener = (tabId, info) => {
        if (tabId === initialTabId && info.status === "complete") {
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
  await ensureOwnedContainerTabGroup(role, container.windowId, [initialTabId]);
  await persistRuntimeState();
  return { windowId: container.windowId, initialTabId };
}
async function findReusableOwnedContainerTab(windowId) {
  try {
    const tabs = await chrome.tabs.query({ windowId });
    const reusable = tabs.find(
      (tab) => tab.id !== void 0 && initialTabIsAvailable(tab.id) && isDebuggableUrl(tab.url)
    );
    return reusable?.id;
  } catch {
    return void 0;
  }
}
function initialTabIsAvailable(tabId) {
  if (tabId === void 0) return false;
  for (const session of automationSessions.values()) {
    if (session.owned && session.preferredTabId === tabId) return false;
  }
  return true;
}
async function createOwnedTabLease(leaseKey, initialUrl) {
  return withLeaseMutation(() => createOwnedTabLeaseUnlocked(leaseKey, initialUrl));
}
async function createOwnedTabLeaseUnlocked(leaseKey, initialUrl) {
  const targetUrl = initialUrl && isSafeNavigationUrl(initialUrl) ? initialUrl : BLANK_PAGE;
  const role = getOwnedWindowRole(leaseKey);
  const { windowId, initialTabId } = await ensureOwnedContainerWindow(role, targetUrl, getWindowMode(leaseKey));
  let tab;
  if (initialTabIsAvailable(initialTabId)) {
    tab = await chrome.tabs.get(initialTabId);
    if (!isTargetUrl(tab.url, targetUrl)) {
      tab = await chrome.tabs.update(initialTabId, { url: targetUrl });
      await new Promise((resolve) => setTimeout(resolve, 300));
      tab = await chrome.tabs.get(initialTabId);
    }
  } else {
    tab = await chrome.tabs.create({ windowId, url: targetUrl, active: true });
  }
  if (!tab.id) throw new Error("Failed to create tab lease in automation container");
  await ensureOwnedContainerTabGroup(role, windowId, [tab.id]);
  setLeaseSession(leaseKey, {
    session: getSessionFromKey(leaseKey),
    surface: getSurfaceFromKey(leaseKey),
    kind: "owned",
    windowId,
    owned: true,
    preferredTabId: tab.id
  });
  resetWindowIdleTimer(leaseKey);
  return { tabId: tab.id, tab };
}
async function getAutomationWindow(leaseKey, initialUrl) {
  const existing = automationSessions.get(leaseKey);
  if (existing) {
    if (!existing.owned) {
      throw new CommandFailure(
        "bound_window_operation_blocked",
        `Session "${existing.session}" is bound to a user tab and does not own an OpenCLI tab lease.`,
        "Use page commands on the bound tab, or unbind the session first."
      );
    }
    try {
      const tabId = existing.preferredTabId;
      if (tabId !== null) {
        const tab = await chrome.tabs.get(tabId);
        if (isDebuggableUrl(tab.url)) return tab.windowId;
      }
      await chrome.windows.get(existing.windowId);
      return existing.windowId;
    } catch {
      await removeLeaseSession(leaseKey);
    }
  }
  const role = getOwnedWindowRole(leaseKey);
  return (await ensureOwnedContainerWindow(role, initialUrl, getWindowMode(leaseKey))).windowId;
}
chrome.windows.onRemoved.addListener(async (windowId) => {
  for (const container of Object.values(ownedContainers)) {
    if (container.windowId === windowId) {
      container.windowId = null;
      container.groupId = null;
    }
  }
  for (const [leaseKey, session] of automationSessions.entries()) {
    if (session.windowId === windowId) {
      console.log(`[opencli] ${session.surface} container closed (session=${session.session})`);
      if (session.idleTimer) clearTimeout(session.idleTimer);
      automationSessions.delete(leaseKey);
      sessionTimeoutOverrides.delete(leaseKey);
      sessionWindowModeOverrides.delete(leaseKey);
      sessionLifecycleOverrides.delete(leaseKey);
      scheduleIdleAlarm(leaseKey, IDLE_TIMEOUT_NONE);
    }
  }
  await persistRuntimeState();
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
  evictTab(tabId);
  for (const [leaseKey, session] of automationSessions.entries()) {
    if (session.preferredTabId === tabId) {
      if (session.idleTimer) clearTimeout(session.idleTimer);
      automationSessions.delete(leaseKey);
      sessionTimeoutOverrides.delete(leaseKey);
      sessionWindowModeOverrides.delete(leaseKey);
      sessionLifecycleOverrides.delete(leaseKey);
      scheduleIdleAlarm(leaseKey, IDLE_TIMEOUT_NONE);
      console.log(`[opencli] Session ${session.session} detached from tab ${tabId} (tab closed)`);
    }
  }
  await persistRuntimeState();
});
let initialized = false;
function initialize() {
  if (initialized) return;
  initialized = true;
  chrome.alarms.create("keepalive", { periodInMinutes: 0.4 });
  registerListeners();
  try {
    const registerFrameTracking$1 = registerFrameTracking;
    registerFrameTracking$1?.();
  } catch {
  }
  void (async () => {
    await getCurrentContextId();
    await reconcileTargetLeaseRegistry();
    await connect();
  })();
  console.log("[opencli] OpenCLI extension initialized");
}
chrome.runtime.onInstalled.addListener(() => {
  initialize();
});
chrome.runtime.onStartup.addListener(() => {
  initialize();
});
initialize();
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "keepalive") void connect();
  const leaseKey = leaseKeyFromAlarmName(alarm.name);
  if (leaseKey) await releaseLease(leaseKey, "idle alarm");
});
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "getStatus") {
    void (async () => {
      const contextId = await getCurrentContextId();
      const connected = ws?.readyState === WebSocket.OPEN;
      const extensionVersion = chrome.runtime.getManifest().version;
      const daemonVersion = connected ? await fetchDaemonVersion() : null;
      sendResponse({
        connected,
        reconnecting: reconnectTimer !== null,
        contextId,
        extensionVersion,
        daemonVersion
      });
    })();
    return true;
  }
  return false;
});
async function fetchDaemonVersion() {
  try {
    const res = await fetch(`http://${DAEMON_HOST}:${DAEMON_PORT}/status`, {
      method: "GET",
      headers: { "X-OpenCLI": "1" },
      signal: AbortSignal.timeout(1500)
    });
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body.daemonVersion === "string" ? body.daemonVersion : null;
  } catch {
    return null;
  }
}
async function handleCommand(cmd) {
  const session = getSessionName(cmd.session);
  const surface = getCommandSurface(cmd);
  const leaseKey = getLeaseKey(session, surface);
  if (cmd.windowMode === "foreground" || cmd.windowMode === "background") {
    sessionWindowModeOverrides.set(leaseKey, cmd.windowMode);
  }
  if (surface === "adapter" && (cmd.siteSession === "persistent" || cmd.siteSession === "ephemeral")) {
    sessionLifecycleOverrides.set(leaseKey, cmd.siteSession);
  }
  if (cmd.idleTimeout != null && cmd.idleTimeout > 0) {
    sessionTimeoutOverrides.set(leaseKey, cmd.idleTimeout * 1e3);
  }
  resetWindowIdleTimer(leaseKey);
  try {
    switch (cmd.action) {
      case "exec":
        return await handleExec(cmd, leaseKey);
      case "navigate":
        return await handleNavigate(cmd, leaseKey);
      case "tabs":
        return await handleTabs(cmd, leaseKey);
      case "cookies":
        return await handleCookies(cmd);
      case "screenshot":
        return await handleScreenshot(cmd, leaseKey);
      case "close-window":
        return await handleCloseWindow(cmd, leaseKey);
      case "cdp":
        return await handleCdp(cmd, leaseKey);
      case "set-file-input":
        return await handleSetFileInput(cmd, leaseKey);
      case "insert-text":
        return await handleInsertText(cmd, leaseKey);
      case "bind":
        return await handleBind(cmd, leaseKey);
      case "network-capture-start":
        return await handleNetworkCaptureStart(cmd, leaseKey);
      case "network-capture-read":
        return await handleNetworkCaptureRead(cmd, leaseKey);
      case "wait-download":
        return await handleWaitDownload(cmd);
      case "frames":
        return await handleFrames(cmd, leaseKey);
      default:
        return { id: cmd.id, ok: false, error: `Unknown action: ${cmd.action}` };
    }
  } catch (err) {
    return {
      id: cmd.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ...err instanceof CommandFailure ? { errorCode: err.code } : {},
      ...err instanceof CommandFailure && err.hint ? { errorHint: err.hint } : {}
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
function getUrlOrigin(url) {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
function enumerateCrossOriginFrames(tree) {
  const frames = [];
  function collect(node, accessibleOrigin) {
    for (const child of node.childFrames || []) {
      const frame = child.frame;
      const frameUrl = frame.url || frame.unreachableUrl || "";
      const frameOrigin = getUrlOrigin(frameUrl);
      if (accessibleOrigin && frameOrigin && frameOrigin === accessibleOrigin) {
        collect(child, frameOrigin);
        continue;
      }
      frames.push({
        index: frames.length,
        frameId: frame.id,
        url: frameUrl,
        name: frame.name || ""
      });
    }
  }
  const rootFrame = tree?.frameTree?.frame;
  const rootUrl = rootFrame?.url || rootFrame?.unreachableUrl || "";
  collect(tree.frameTree, getUrlOrigin(rootUrl));
  return frames;
}
function setLeaseSession(leaseKey, session) {
  const existing = automationSessions.get(leaseKey);
  if (existing?.idleTimer) clearTimeout(existing.idleTimer);
  const timeout = getIdleTimeout(leaseKey);
  automationSessions.set(leaseKey, {
    ...makeSession(leaseKey, session),
    idleTimer: null,
    idleDeadlineAt: timeout <= 0 ? 0 : Date.now() + timeout
  });
  void persistRuntimeState();
}
async function resolveCommandTabId(cmd) {
  if (cmd.page) return resolveTabId$1(cmd.page);
  return void 0;
}
async function resolveTab(tabId, leaseKey, initialUrl) {
  const existingSession = automationSessions.get(leaseKey);
  if (tabId !== void 0) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const session = existingSession;
      const matchesSession = session ? session.preferredTabId !== null ? session.preferredTabId === tabId : tab.windowId === session.windowId : false;
      if (isDebuggableUrl(tab.url) && matchesSession) return { tabId, tab };
      if (session && !session.owned) {
        throw new CommandFailure(
          matchesSession ? "bound_tab_not_debuggable" : "bound_tab_mismatch",
          matchesSession ? `Bound tab for session "${session.session}" is not debuggable (${tab.url ?? "unknown URL"}).` : `Target tab is not the tab bound to session "${session.session}".`,
          'Run "opencli browser bind" again on a debuggable http(s) tab.'
        );
      }
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
    } catch (err) {
      if (err instanceof CommandFailure) throw err;
      if (existingSession && !existingSession.owned) {
        automationSessions.delete(leaseKey);
        throw new CommandFailure(
          "bound_tab_gone",
          `Bound tab for session "${existingSession.session}" no longer exists.`,
          'Run "opencli browser bind" again, then retry the command.'
        );
      }
      console.warn(`[opencli] Tab ${tabId} no longer exists, re-resolving`);
    }
  }
  const existingPreferredTabId = existingSession?.preferredTabId ?? null;
  if (existingSession && existingPreferredTabId !== null) {
    const session = existingSession;
    try {
      const preferredTab = await chrome.tabs.get(existingPreferredTabId);
      if (isDebuggableUrl(preferredTab.url)) return { tabId: preferredTab.id, tab: preferredTab };
      if (!session.owned) {
        throw new CommandFailure(
          "bound_tab_not_debuggable",
          `Bound tab for session "${session.session}" is not debuggable (${preferredTab.url ?? "unknown URL"}).`,
          'Switch the tab to an http(s) page or run "opencli browser bind" on another tab.'
        );
      }
    } catch (err) {
      if (err instanceof CommandFailure) throw err;
      await removeLeaseSession(leaseKey);
      if (!session.owned) {
        throw new CommandFailure(
          "bound_tab_gone",
          `Bound tab for session "${session.session}" no longer exists.`,
          'Run "opencli browser bind" again, then retry the command.'
        );
      }
      return createOwnedTabLease(leaseKey, initialUrl);
    }
  }
  if (!existingSession || existingSession.owned && existingSession.preferredTabId === null) {
    return createOwnedTabLease(leaseKey, initialUrl);
  }
  const windowId = await getAutomationWindow(leaseKey, initialUrl);
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
  if (!newTab.id) throw new Error("Failed to create tab in automation container");
  return { tabId: newTab.id, tab: newTab };
}
async function pageScopedResult(id, tabId, data) {
  const page = await resolveTargetId(tabId);
  return { id, ok: true, data, page };
}
async function resolveTabId(tabId, leaseKey, initialUrl) {
  const resolved = await resolveTab(tabId, leaseKey, initialUrl);
  return resolved.tabId;
}
async function listAutomationTabs(leaseKey) {
  const session = automationSessions.get(leaseKey);
  if (!session) return [];
  if (session.preferredTabId !== null) {
    try {
      return [await chrome.tabs.get(session.preferredTabId)];
    } catch {
      automationSessions.delete(leaseKey);
      return [];
    }
  }
  try {
    return await chrome.tabs.query({ windowId: session.windowId });
  } catch {
    automationSessions.delete(leaseKey);
    return [];
  }
}
async function listAutomationWebTabs(leaseKey) {
  const tabs = await listAutomationTabs(leaseKey);
  return tabs.filter((tab) => isDebuggableUrl(tab.url));
}
async function handleExec(cmd, leaseKey) {
  if (!cmd.code) return { id: cmd.id, ok: false, error: "Missing code" };
  const cmdTabId = await resolveCommandTabId(cmd);
  const tabId = await resolveTabId(cmdTabId, leaseKey);
  try {
    const aggressive = getSurfaceFromKey(leaseKey) === "browser";
    if (cmd.frameIndex != null) {
      const tree = await getFrameTree(tabId);
      const frames = enumerateCrossOriginFrames(tree);
      if (cmd.frameIndex < 0 || cmd.frameIndex >= frames.length) {
        return { id: cmd.id, ok: false, error: `Frame index ${cmd.frameIndex} out of range (${frames.length} cross-origin frames available)` };
      }
      const data2 = await evaluateInFrame(tabId, cmd.code, frames[cmd.frameIndex].frameId, aggressive);
      return pageScopedResult(cmd.id, tabId, data2);
    }
    const data = await evaluateAsync(tabId, cmd.code, aggressive);
    return pageScopedResult(cmd.id, tabId, data);
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
async function handleFrames(cmd, leaseKey) {
  const cmdTabId = await resolveCommandTabId(cmd);
  const tabId = await resolveTabId(cmdTabId, leaseKey);
  try {
    const tree = await getFrameTree(tabId);
    return { id: cmd.id, ok: true, data: enumerateCrossOriginFrames(tree) };
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
async function handleNavigate(cmd, leaseKey) {
  if (!cmd.url) return { id: cmd.id, ok: false, error: "Missing url" };
  if (!isSafeNavigationUrl(cmd.url)) {
    return { id: cmd.id, ok: false, error: "Blocked URL scheme -- only http:// and https:// are allowed" };
  }
  const cmdTabId = await resolveCommandTabId(cmd);
  const resolved = await resolveTab(cmdTabId, leaseKey, cmd.url);
  const tabId = resolved.tabId;
  const beforeTab = resolved.tab ?? await chrome.tabs.get(tabId);
  const beforeNormalized = normalizeUrlForComparison(beforeTab.url);
  const targetUrl = cmd.url;
  if (beforeTab.status === "complete" && isTargetUrl(beforeTab.url, targetUrl)) {
    return pageScopedResult(cmd.id, tabId, { title: beforeTab.title, url: beforeTab.url, timedOut: false });
  }
  if (!hasActiveNetworkCapture(tabId)) {
    await detach(tabId);
  }
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
  const postNavigationSession = automationSessions.get(leaseKey);
  if (postNavigationSession && tab.windowId !== postNavigationSession.windowId) {
    console.warn(`[opencli] Tab ${tabId} drifted to window ${tab.windowId} during navigation, moving back to ${postNavigationSession.windowId}`);
    try {
      await chrome.tabs.move(tabId, { windowId: postNavigationSession.windowId, index: -1 });
      tab = await chrome.tabs.get(tabId);
    } catch (moveErr) {
      console.warn(`[opencli] Failed to recover drifted tab: ${moveErr}`);
    }
  }
  return pageScopedResult(cmd.id, tabId, { title: tab.title, url: tab.url, timedOut });
}
async function handleTabs(cmd, leaseKey) {
  const session = automationSessions.get(leaseKey);
  if (session && !session.owned && cmd.op !== "list") {
    return {
      id: cmd.id,
      ok: false,
      errorCode: "bound_tab_mutation_blocked",
      error: `Session "${session.session}" is bound to a user tab; tab new/select/close requires an owned OpenCLI session.`,
      errorHint: "Unbind the session first, or use a different session for owned OpenCLI tabs."
    };
  }
  switch (cmd.op) {
    case "list": {
      const tabs = await listAutomationWebTabs(leaseKey);
      const data = await Promise.all(tabs.map(async (t, i) => {
        let page;
        try {
          page = t.id ? await resolveTargetId(t.id) : void 0;
        } catch {
        }
        return { index: i, page, url: t.url, title: t.title, active: t.active };
      }));
      return { id: cmd.id, ok: true, data };
    }
    case "new": {
      if (cmd.url && !isSafeNavigationUrl(cmd.url)) {
        return { id: cmd.id, ok: false, error: "Blocked URL scheme -- only http:// and https:// are allowed" };
      }
      if (!automationSessions.has(leaseKey)) {
        const created = await createOwnedTabLease(leaseKey, cmd.url);
        return pageScopedResult(cmd.id, created.tabId, { url: created.tab?.url });
      }
      const windowId = await getAutomationWindow(leaseKey);
      const tab = await chrome.tabs.create({ windowId, url: cmd.url ?? BLANK_PAGE, active: true });
      if (!tab.id) return { id: cmd.id, ok: false, error: "Failed to create tab" };
      await ensureOwnedContainerTabGroup(getOwnedWindowRole(leaseKey), windowId, [tab.id]);
      setLeaseSession(leaseKey, {
        session: getSessionFromKey(leaseKey),
        surface: getSurfaceFromKey(leaseKey),
        kind: "owned",
        windowId: tab.windowId,
        owned: true,
        preferredTabId: tab.id
      });
      resetWindowIdleTimer(leaseKey);
      return pageScopedResult(cmd.id, tab.id, { url: tab.url });
    }
    case "close": {
      if (cmd.index !== void 0) {
        const tabs = await listAutomationWebTabs(leaseKey);
        const target = tabs[cmd.index];
        if (!target?.id) return { id: cmd.id, ok: false, error: `Tab index ${cmd.index} not found` };
        const closedPage2 = await resolveTargetId(target.id).catch(() => void 0);
        const currentSession2 = automationSessions.get(leaseKey);
        if (currentSession2?.preferredTabId === target.id) {
          await releaseLease(leaseKey, "tab close");
        } else {
          await safeDetach(target.id);
          await chrome.tabs.remove(target.id);
        }
        return { id: cmd.id, ok: true, data: { closed: closedPage2 } };
      }
      const cmdTabId = await resolveCommandTabId(cmd);
      const tabId = await resolveTabId(cmdTabId, leaseKey);
      const closedPage = await resolveTargetId(tabId).catch(() => void 0);
      const currentSession = automationSessions.get(leaseKey);
      if (currentSession?.preferredTabId === tabId) {
        await releaseLease(leaseKey, "tab close");
      } else {
        await safeDetach(tabId);
        await chrome.tabs.remove(tabId);
      }
      return { id: cmd.id, ok: true, data: { closed: closedPage } };
    }
    case "select": {
      if (cmd.index === void 0 && cmd.page === void 0)
        return { id: cmd.id, ok: false, error: "Missing index or page" };
      const cmdTabId = await resolveCommandTabId(cmd);
      if (cmdTabId !== void 0) {
        const session2 = automationSessions.get(leaseKey);
        let tab;
        try {
          tab = await chrome.tabs.get(cmdTabId);
        } catch {
          return { id: cmd.id, ok: false, error: `Page no longer exists` };
        }
        if (!session2 || tab.windowId !== session2.windowId) {
          return { id: cmd.id, ok: false, error: `Page is not in the automation container` };
        }
        await chrome.tabs.update(cmdTabId, { active: true });
        return pageScopedResult(cmd.id, cmdTabId, { selected: true });
      }
      const tabs = await listAutomationWebTabs(leaseKey);
      const target = tabs[cmd.index];
      if (!target?.id) return { id: cmd.id, ok: false, error: `Tab index ${cmd.index} not found` };
      await chrome.tabs.update(target.id, { active: true });
      return pageScopedResult(cmd.id, target.id, { selected: true });
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
async function handleScreenshot(cmd, leaseKey) {
  const cmdTabId = await resolveCommandTabId(cmd);
  const tabId = await resolveTabId(cmdTabId, leaseKey);
  try {
    const data = await screenshot(tabId, {
      format: cmd.format,
      quality: cmd.quality,
      fullPage: cmd.fullPage,
      width: cmd.width,
      height: cmd.height
    });
    return pageScopedResult(cmd.id, tabId, data);
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
const CDP_ALLOWLIST = /* @__PURE__ */ new Set([
  // Agent DOM context
  "Accessibility.enable",
  "Accessibility.getFullAXTree",
  "DOM.enable",
  "DOM.getDocument",
  "DOM.getBoxModel",
  "DOM.getContentQuads",
  "DOM.focus",
  "DOM.querySelector",
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
  "Page.getFrameTree",
  "Page.handleJavaScriptDialog",
  // Runtime.enable needed for CDP attach setup (Runtime.evaluate goes through 'exec' action)
  "Runtime.enable",
  // Emulation (used by screenshot full-page)
  "Emulation.setDeviceMetricsOverride",
  "Emulation.clearDeviceMetricsOverride"
]);
async function handleCdp(cmd, leaseKey) {
  if (!cmd.cdpMethod) return { id: cmd.id, ok: false, error: "Missing cdpMethod" };
  if (!CDP_ALLOWLIST.has(cmd.cdpMethod)) {
    return { id: cmd.id, ok: false, error: `CDP method not permitted: ${cmd.cdpMethod}` };
  }
  const cmdTabId = await resolveCommandTabId(cmd);
  const tabId = await resolveTabId(cmdTabId, leaseKey);
  try {
    const aggressive = getSurfaceFromKey(leaseKey) === "browser";
    await ensureAttached(tabId, aggressive);
    const params = cmd.cdpParams ?? {};
    const routeFrameId = typeof params.frameId === "string" && params.sessionId === "target" ? params.frameId : void 0;
    const routeTargetUrl = typeof params.targetUrl === "string" ? params.targetUrl : void 0;
    const data = routeFrameId ? await sendCommandInFrameTarget(tabId, routeFrameId, cmd.cdpMethod, stripOpenCliFrameRoutingParams(params, true), aggressive, 3e4, routeTargetUrl) : await chrome.debugger.sendCommand(
      { tabId },
      cmd.cdpMethod,
      stripOpenCliFrameRoutingParams(params, false)
    );
    return pageScopedResult(cmd.id, tabId, data);
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
function stripOpenCliFrameRoutingParams(params, stripFrameId) {
  const { sessionId, frameId, targetUrl, ...rest } = params;
  if (!stripFrameId && frameId !== void 0) return { ...rest, frameId };
  return rest;
}
async function handleCloseWindow(cmd, leaseKey) {
  const sessionName = automationSessions.get(leaseKey)?.session ?? getSessionFromKey(leaseKey);
  await releaseLease(leaseKey, "explicit close");
  return { id: cmd.id, ok: true, data: { closed: true, session: sessionName } };
}
async function handleSetFileInput(cmd, leaseKey) {
  if (!cmd.files || !Array.isArray(cmd.files) || cmd.files.length === 0) {
    return { id: cmd.id, ok: false, error: "Missing or empty files array" };
  }
  const cmdTabId = await resolveCommandTabId(cmd);
  const tabId = await resolveTabId(cmdTabId, leaseKey);
  try {
    await setFileInputFiles(tabId, cmd.files, cmd.selector);
    return pageScopedResult(cmd.id, tabId, { count: cmd.files.length });
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
async function handleInsertText(cmd, leaseKey) {
  if (typeof cmd.text !== "string") {
    return { id: cmd.id, ok: false, error: "Missing text payload" };
  }
  const cmdTabId = await resolveCommandTabId(cmd);
  const tabId = await resolveTabId(cmdTabId, leaseKey);
  try {
    await insertText(tabId, cmd.text);
    return pageScopedResult(cmd.id, tabId, { inserted: true });
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
async function handleNetworkCaptureStart(cmd, leaseKey) {
  const cmdTabId = await resolveCommandTabId(cmd);
  const tabId = await resolveTabId(cmdTabId, leaseKey);
  try {
    await startNetworkCapture(tabId, cmd.pattern);
    return pageScopedResult(cmd.id, tabId, { started: true });
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
async function handleNetworkCaptureRead(cmd, leaseKey) {
  const cmdTabId = await resolveCommandTabId(cmd);
  const tabId = await resolveTabId(cmdTabId, leaseKey);
  try {
    const data = await readNetworkCapture(tabId);
    return pageScopedResult(cmd.id, tabId, data);
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
async function handleWaitDownload(cmd) {
  try {
    const data = await waitForDownload(cmd.pattern ?? "", cmd.timeoutMs ?? 3e4);
    return { id: cmd.id, ok: true, data };
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
async function releaseLease(leaseKey, reason = "released") {
  const session = automationSessions.get(leaseKey);
  if (!session) {
    sessionTimeoutOverrides.delete(leaseKey);
    sessionWindowModeOverrides.delete(leaseKey);
    sessionLifecycleOverrides.delete(leaseKey);
    scheduleIdleAlarm(leaseKey, IDLE_TIMEOUT_NONE);
    await persistRuntimeState();
    return;
  }
  if (session.idleTimer) clearTimeout(session.idleTimer);
  scheduleIdleAlarm(leaseKey, IDLE_TIMEOUT_NONE);
  if (session.owned) {
    const tabId = session.preferredTabId;
    if (tabId !== null) {
      const hasOtherOwnedLease = [...automationSessions.entries()].some(
        ([otherLease, otherSession]) => otherLease !== leaseKey && otherSession.owned && otherSession.windowId === session.windowId && otherSession.preferredTabId !== null
      );
      await safeDetach(tabId);
      evictTab(tabId);
      if (hasOtherOwnedLease) {
        await chrome.tabs.remove(tabId).catch(() => {
        });
        console.log(`[opencli] Released owned tab lease ${tabId} (session=${session.session}, surface=${session.surface}, ${reason})`);
      } else {
        try {
          const tab = await chrome.tabs.update(tabId, { url: BLANK_PAGE, active: true });
          await ensureOwnedContainerTabGroup(getOwnedWindowRole(leaseKey), session.windowId, [tab.id ?? tabId]);
          console.log(`[opencli] Released owned tab lease ${tabId} as reusable placeholder (session=${session.session}, surface=${session.surface}, ${reason})`);
        } catch {
          await chrome.tabs.remove(tabId).catch(() => {
          });
          console.log(`[opencli] Released owned tab lease ${tabId} (session=${session.session}, surface=${session.surface}, ${reason})`);
        }
      }
    } else {
      console.log(`[opencli] Released legacy owned window lease ${session.windowId} without closing container (session=${session.session}, surface=${session.surface}, ${reason})`);
    }
  } else if (session.preferredTabId !== null) {
    await safeDetach(session.preferredTabId);
    console.log(`[opencli] Detached borrowed tab lease ${session.preferredTabId} (session=${session.session}, surface=${session.surface}, ${reason})`);
  }
  automationSessions.delete(leaseKey);
  sessionTimeoutOverrides.delete(leaseKey);
  sessionWindowModeOverrides.delete(leaseKey);
  sessionLifecycleOverrides.delete(leaseKey);
  await persistRuntimeState();
}
async function reconcileTargetLeaseRegistry() {
  const registry = await readRegistry();
  for (const role of Object.keys(ownedContainers)) {
    ownedContainers[role].windowId = registry.ownedContainers[role]?.windowId ?? null;
    ownedContainers[role].groupId = registry.ownedContainers[role]?.groupId ?? null;
    const windowId = ownedContainers[role].windowId;
    if (windowId !== null) {
      try {
        await chrome.windows.get(windowId);
      } catch {
        ownedContainers[role].windowId = null;
        ownedContainers[role].groupId = null;
      }
    }
  }
  automationSessions.clear();
  for (const [leaseKey, stored] of Object.entries(registry.leases)) {
    const tabId = stored.preferredTabId;
    if (tabId === null) continue;
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!isDebuggableUrl(tab.url)) continue;
      if (stored.lifecycle === "ephemeral" || stored.lifecycle === "persistent" || stored.lifecycle === "pinned") {
        sessionLifecycleOverrides.set(leaseKey, stored.lifecycle);
      }
      const session = makeSession(leaseKey, {
        session: typeof stored.session === "string" ? stored.session : getSessionFromKey(leaseKey),
        surface: stored.surface === "adapter" ? "adapter" : getSurfaceFromKey(leaseKey),
        kind: stored.kind === "bound" || stored.owned === false ? "bound" : "owned",
        windowId: tab.windowId,
        owned: stored.owned,
        preferredTabId: tabId
      });
      const timeout = getIdleTimeout(leaseKey);
      automationSessions.set(leaseKey, {
        ...session,
        idleTimer: null,
        idleDeadlineAt: stored.idleDeadlineAt
      });
      if (session.owned) {
        const role = getOwnedWindowRole(leaseKey);
        if (ownedContainers[role].windowId === null) ownedContainers[role].windowId = tab.windowId;
        await ensureOwnedContainerTabGroup(role, tab.windowId, [tabId]);
      }
      const remaining = stored.idleDeadlineAt > 0 ? stored.idleDeadlineAt - Date.now() : timeout;
      if (timeout > 0) {
        if (remaining <= 0) {
          await releaseLease(leaseKey, "reconciled idle expiry");
        } else {
          resetWindowIdleTimer(leaseKey);
        }
      }
    } catch {
    }
  }
  await persistRuntimeState();
}
async function handleBind(cmd, leaseKey) {
  const existing = automationSessions.get(leaseKey);
  if (existing?.owned) {
    await releaseLease(leaseKey, "rebind");
  }
  const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const fallbackTabs = await chrome.tabs.query({ lastFocusedWindow: true });
  const boundTab = activeTabs.find((tab) => isDebuggableUrl(tab.url)) ?? fallbackTabs.find((tab) => isDebuggableUrl(tab.url));
  if (!boundTab?.id) {
    return {
      id: cmd.id,
      ok: false,
      errorCode: "bound_tab_not_found",
      error: "No debuggable tab found in the current window",
      errorHint: "Focus the target Chrome tab/window, then retry bind."
    };
  }
  const current = automationSessions.get(leaseKey);
  if (current && !current.owned && current.preferredTabId !== null && current.preferredTabId !== boundTab.id) {
    await detach(current.preferredTabId).catch(() => {
    });
  }
  setLeaseSession(leaseKey, {
    session: getSessionFromKey(leaseKey),
    surface: getSurfaceFromKey(leaseKey),
    kind: "bound",
    windowId: boundTab.windowId,
    owned: false,
    preferredTabId: boundTab.id
  });
  resetWindowIdleTimer(leaseKey);
  console.log(`[opencli] Session ${getSessionFromKey(leaseKey)} explicitly bound to tab ${boundTab.id} (${boundTab.url})`);
  return pageScopedResult(cmd.id, boundTab.id, {
    url: boundTab.url,
    title: boundTab.title,
    session: getSessionFromKey(leaseKey)
  });
}
