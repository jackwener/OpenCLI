//#region src/protocol.ts
/** Default daemon port */
var DAEMON_PORT = 19825;
var DAEMON_HOST = "localhost";
var DAEMON_WS_URL = `ws://${DAEMON_HOST}:${DAEMON_PORT}/ext`;
/** Lightweight health-check endpoint — probed before each WebSocket attempt. */
var DAEMON_PING_URL = `http://${DAEMON_HOST}:${DAEMON_PORT}/ping`;
/** Base reconnect delay for extension WebSocket (ms) */
var WS_RECONNECT_BASE_DELAY = 2e3;
/** Max reconnect delay (ms) — kept short since daemon is long-lived */
var WS_RECONNECT_MAX_DELAY = 5e3;
//#endregion
//#region src/cdp.ts
/**
* CDP execution via chrome.debugger API.
*
* chrome.debugger only needs the "debugger" permission — no host_permissions.
* It can attach to any http/https tab. Avoid chrome:// and chrome-extension://
* tabs (resolveTabId in background.ts filters them).
*/
var attached = /* @__PURE__ */ new Set();
var tabFrameContexts = /* @__PURE__ */ new Map();
var CDP_RESPONSE_BODY_CAPTURE_LIMIT = 8 * 1024 * 1024;
var CDP_REQUEST_BODY_CAPTURE_LIMIT = 1 * 1024 * 1024;
var networkCaptures = /* @__PURE__ */ new Map();
/** Check if a URL can be attached via CDP — only allow http(s) and blank pages. */
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
	if (attached.has(tabId)) try {
		await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
			expression: "1",
			returnByValue: true
		});
		return;
	} catch {
		attached.delete(tabId);
	}
	const MAX_ATTACH_RETRIES = aggressiveRetry ? 5 : 2;
	const RETRY_DELAY_MS = aggressiveRetry ? 1500 : 500;
	let lastError = "";
	for (let attempt = 1; attempt <= MAX_ATTACH_RETRIES; attempt++) try {
		try {
			await chrome.debugger.detach({ tabId });
		} catch {}
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
	if (lastError) {
		let finalUrl = "unknown";
		let finalWindowId = "unknown";
		try {
			const tab = await chrome.tabs.get(tabId);
			finalUrl = tab.url ?? "undefined";
			finalWindowId = String(tab.windowId);
		} catch {}
		console.warn(`[opencli] attach failed for tab ${tabId}: url=${finalUrl}, windowId=${finalWindowId}, error=${lastError}`);
		const hint = lastError.includes("chrome-extension://") ? ". Tip: another Chrome extension may be interfering — try disabling other extensions" : "";
		throw new Error(`attach failed: ${lastError}${hint}`);
	}
	attached.add(tabId);
	try {
		await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
	} catch {}
}
async function evaluate(tabId, expression, aggressiveRetry = false) {
	const MAX_EVAL_RETRIES = aggressiveRetry ? 3 : 2;
	for (let attempt = 1; attempt <= MAX_EVAL_RETRIES; attempt++) try {
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
		if ((isNavigateError || msg.includes("attach failed") || msg.includes("Debugger is not attached") || msg.includes("chrome-extension://")) && attempt < MAX_EVAL_RETRIES) {
			attached.delete(tabId);
			const retryMs = isNavigateError ? 200 : 500;
			await new Promise((resolve) => setTimeout(resolve, retryMs));
			continue;
		}
		throw e;
	}
	throw new Error("evaluate: max retries exhausted");
}
var evaluateAsync = evaluate;
/**
* Capture a screenshot via CDP Page.captureScreenshot.
* Returns base64-encoded image data.
*/
async function screenshot(tabId, options = {}) {
	await ensureAttached(tabId);
	const format = options.format ?? "png";
	const fullPage = options.fullPage === true;
	const overrideWidth = options.width && options.width > 0 ? Math.ceil(options.width) : void 0;
	const overrideHeight = !fullPage && options.height && options.height > 0 ? Math.ceil(options.height) : void 0;
	const needsOverride = fullPage || overrideWidth !== void 0 || overrideHeight !== void 0;
	if (needsOverride) {
		if (overrideWidth !== void 0 && fullPage) await chrome.debugger.sendCommand({ tabId }, "Emulation.setDeviceMetricsOverride", {
			mobile: false,
			width: overrideWidth,
			height: 0,
			deviceScaleFactor: 1
		});
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
		if (format === "jpeg" && options.quality !== void 0) params.quality = Math.max(0, Math.min(100, options.quality));
		return (await chrome.debugger.sendCommand({ tabId }, "Page.captureScreenshot", params)).data;
	} finally {
		if (needsOverride) await chrome.debugger.sendCommand({ tabId }, "Emulation.clearDeviceMetricsOverride").catch(() => {});
	}
}
/**
* Set local file paths on a file input element via CDP DOM.setFileInputFiles.
* This bypasses the need to send large base64 payloads through the message channel —
* Chrome reads the files directly from the local filesystem.
*
* @param tabId - Target tab ID
* @param files - Array of absolute local file paths
* @param selector - CSS selector to find the file input (optional, defaults to first file input)
*/
async function setFileInputFiles(tabId, files, selector) {
	await ensureAttached(tabId);
	await chrome.debugger.sendCommand({ tabId }, "DOM.enable");
	const doc = await chrome.debugger.sendCommand({ tabId }, "DOM.getDocument");
	const query = selector || "input[type=\"file\"]";
	const result = await chrome.debugger.sendCommand({ tabId }, "DOM.querySelector", {
		nodeId: doc.root.nodeId,
		selector: query
	});
	if (!result.nodeId) throw new Error(`No element found matching selector: ${query}`);
	await chrome.debugger.sendCommand({ tabId }, "DOM.setFileInputFiles", {
		files,
		nodeId: result.nodeId
	});
}
async function insertText(tabId, text) {
	await ensureAttached(tabId);
	await chrome.debugger.sendCommand({ tabId }, "Input.insertText", { text });
}
function registerFrameTracking() {
	chrome.debugger.onEvent.addListener((source, method, params) => {
		const tabId = source.tabId;
		if (!tabId) return;
		if (method === "Runtime.executionContextCreated") {
			const context = params.context;
			if (!context?.auxData?.frameId || context.auxData.isDefault !== true) return;
			const frameId = context.auxData.frameId;
			if (!tabFrameContexts.has(tabId)) tabFrameContexts.set(tabId, /* @__PURE__ */ new Map());
			tabFrameContexts.get(tabId).set(frameId, context.id);
		}
		if (method === "Runtime.executionContextDestroyed") {
			const ctxId = params.executionContextId;
			const contexts = tabFrameContexts.get(tabId);
			if (contexts) {
				for (const [fid, cid] of contexts) if (cid === ctxId) {
					contexts.delete(fid);
					break;
				}
			}
		}
		if (method === "Runtime.executionContextsCleared") tabFrameContexts.delete(tabId);
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
	await chrome.debugger.sendCommand({ tabId }, "Runtime.enable").catch(() => {});
	const contextId = tabFrameContexts.get(tabId)?.get(frameId);
	if (contextId === void 0) throw new Error(`No execution context found for frame ${frameId}. The frame may not be loaded yet.`);
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
	for (const [key, value] of Object.entries(headers)) out[String(key)] = String(value);
	return out;
}
function getOrCreateNetworkCaptureEntry(tabId, requestId, fallback) {
	const state = networkCaptures.get(tabId);
	if (!state) return null;
	const existingIndex = state.requestToIndex.get(requestId);
	if (existingIndex !== void 0) return state.entries[existingIndex] || null;
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
async function detach(tabId) {
	if (!attached.has(tabId)) return;
	attached.delete(tabId);
	networkCaptures.delete(tabId);
	tabFrameContexts.delete(tabId);
	try {
		await chrome.debugger.detach({ tabId });
	} catch {}
}
function registerListeners() {
	chrome.tabs.onRemoved.addListener((tabId) => {
		attached.delete(tabId);
		networkCaptures.delete(tabId);
		tabFrameContexts.delete(tabId);
	});
	chrome.debugger.onDetach.addListener((source) => {
		if (source.tabId) {
			attached.delete(source.tabId);
			networkCaptures.delete(source.tabId);
			tabFrameContexts.delete(source.tabId);
		}
	});
	chrome.tabs.onUpdated.addListener(async (tabId, info) => {
		if (info.url && !isDebuggableUrl$1(info.url)) await detach(tabId);
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
			} catch {}
			return;
		}
		if (method === "Network.responseReceived") {
			const requestId = String(eventParams?.requestId || "");
			const response = eventParams?.response;
			const entry = getOrCreateNetworkCaptureEntry(tabId, requestId, { url: response?.url });
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
			} catch {}
		}
	});
}
//#endregion
//#region src/identity.ts
/**
* Page identity mapping — targetId ↔ tabId.
*
* targetId is the cross-layer page identity (CDP target UUID).
* tabId is an internal Chrome Tabs API routing detail — never exposed outside the extension.
*
* Lifecycle:
*   - Cache populated lazily via chrome.debugger.getTargets()
*   - Evicted on tab close (chrome.tabs.onRemoved)
*   - Miss triggers full refresh; refresh miss → hard error (no guessing)
*/
var targetToTab = /* @__PURE__ */ new Map();
var tabToTarget = /* @__PURE__ */ new Map();
/**
* Resolve targetId for a given tabId.
* Returns cached value if available; on miss, refreshes from chrome.debugger.getTargets().
* Throws if no targetId can be found (page may have been destroyed).
*/
async function resolveTargetId(tabId) {
	const cached = tabToTarget.get(tabId);
	if (cached) return cached;
	await refreshMappings();
	const result = tabToTarget.get(tabId);
	if (!result) throw new Error(`No targetId for tab ${tabId} — page may have been closed`);
	return result;
}
/**
* Resolve tabId for a given targetId.
* Returns cached value if available; on miss, refreshes from chrome.debugger.getTargets().
* Throws if no tabId can be found — never falls back to guessing.
*/
async function resolveTabId$1(targetId) {
	const cached = targetToTab.get(targetId);
	if (cached !== void 0) return cached;
	await refreshMappings();
	const result = targetToTab.get(targetId);
	if (result === void 0) throw new Error(`Page not found: ${targetId} — stale page identity`);
	return result;
}
/**
* Remove mappings for a closed tab.
* Called from chrome.tabs.onRemoved listener.
*/
function evictTab(tabId) {
	const targetId = tabToTarget.get(tabId);
	if (targetId) targetToTab.delete(targetId);
	tabToTarget.delete(tabId);
}
/**
* Full refresh of targetId ↔ tabId mappings from chrome.debugger.getTargets().
*/
async function refreshMappings() {
	const targets = await chrome.debugger.getTargets();
	targetToTab.clear();
	tabToTarget.clear();
	for (const t of targets) if (t.type === "page" && t.tabId !== void 0) {
		targetToTab.set(t.id, t.tabId);
		tabToTarget.set(t.tabId, t.id);
	}
}
//#endregion
//#region src/background.ts
var ws = null;
var reconnectTimer = null;
var reconnectAttempts = 0;
var CONTEXT_ID_KEY = "opencli_context_id_v1";
var currentContextId = "default";
var contextIdPromise = null;
async function getCurrentContextId() {
	if (contextIdPromise) return contextIdPromise;
	contextIdPromise = (async () => {
		try {
			const local = chrome.storage?.local;
			if (!local) return currentContextId;
			const existing = (await local.get(CONTEXT_ID_KEY))[CONTEXT_ID_KEY];
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
	const maxUnbiasedByte = Math.floor(256 / 31) * 31;
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
			id += alphabet[byte % 31];
			if (id.length === 8) break;
		}
	}
	return id;
}
var _origLog = console.log.bind(console);
var _origWarn = console.warn.bind(console);
var _origError = console.error.bind(console);
function forwardLog(level, args) {
	if (!ws || ws.readyState !== WebSocket.OPEN) return;
	try {
		const msg = args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
		ws.send(JSON.stringify({
			type: "log",
			level,
			msg,
			ts: Date.now()
		}));
	} catch {}
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
/**
* Probe the daemon via its /ping HTTP endpoint before attempting a WebSocket
* connection.  fetch() failures are silently catchable; new WebSocket() is not
* — Chrome logs ERR_CONNECTION_REFUSED to the extension error page before any
* JS handler can intercept it.  By keeping the probe inside connect() every
* call site remains unchanged and the guard can never be accidentally skipped.
*/
async function connect() {
	if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;
	try {
		if (!(await fetch(DAEMON_PING_URL, { signal: AbortSignal.timeout(1e3) })).ok) return;
	} catch {
		return;
	}
	try {
		const contextId = await getCurrentContextId();
		ws = new WebSocket(DAEMON_WS_URL);
		currentContextId = contextId;
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
		ws?.send(JSON.stringify({
			type: "hello",
			contextId: currentContextId,
			version: chrome.runtime.getManifest().version,
			compatRange: ">=1.7.0"
		}));
	};
	ws.onmessage = async (event) => {
		try {
			const result = await handleCommand(JSON.parse(event.data));
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
/**
* After MAX_EAGER_ATTEMPTS (reaching 60s backoff), stop scheduling reconnects.
* The keepalive alarm (~24s) will still call connect() periodically, but at a
* much lower frequency — reducing console noise when the daemon is not running.
*/
var MAX_EAGER_ATTEMPTS = 6;
function scheduleReconnect() {
	if (reconnectTimer) return;
	reconnectAttempts++;
	if (reconnectAttempts > MAX_EAGER_ATTEMPTS) return;
	const delay = Math.min(WS_RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1), WS_RECONNECT_MAX_DELAY);
	reconnectTimer = setTimeout(() => {
		reconnectTimer = null;
		connect();
	}, delay);
}
var automationSessions = /* @__PURE__ */ new Map();
var ownedContainerWindowId = null;
var ownedContainerGroupId = null;
var IDLE_TIMEOUT_DEFAULT = 3e4;
var IDLE_TIMEOUT_INTERACTIVE = 6e5;
var IDLE_TIMEOUT_NONE = -1;
var REGISTRY_KEY = "opencli_target_lease_registry_v1";
var LEASE_IDLE_ALARM_PREFIX = "opencli:lease-idle:";
var AUTOMATION_TAB_GROUP_TITLE = "OpenCLI";
var AUTOMATION_TAB_GROUP_COLOR = "orange";
var leaseMutationQueue = Promise.resolve();
var ownedContainerWindowPromise = null;
var CommandFailure = class extends Error {
	constructor(code, message, hint) {
		super(message);
		this.code = code;
		this.hint = hint;
		this.name = "CommandFailure";
	}
};
/** Per-workspace custom timeout overrides set via command.idleTimeout */
var workspaceTimeoutOverrides = /* @__PURE__ */ new Map();
function getIdleTimeout(workspace) {
	if (workspace.startsWith("bound:")) return IDLE_TIMEOUT_NONE;
	const override = workspaceTimeoutOverrides.get(workspace);
	if (override !== void 0) return override;
	if (workspace.startsWith("browser:") || workspace.startsWith("operate:")) return IDLE_TIMEOUT_INTERACTIVE;
	return IDLE_TIMEOUT_DEFAULT;
}
var windowFocused = false;
function getWorkspaceKey(workspace) {
	return workspace?.trim() || "default";
}
function getLeaseLifecycle(workspace) {
	if (workspace.startsWith("bound:")) return "pinned";
	if (workspace.startsWith("browser:") || workspace.startsWith("operate:")) return "persistent";
	return "ephemeral";
}
function makeAlarmName(workspace) {
	return `${LEASE_IDLE_ALARM_PREFIX}${encodeURIComponent(workspace)}`;
}
function workspaceFromAlarmName(name) {
	if (!name.startsWith(LEASE_IDLE_ALARM_PREFIX)) return null;
	try {
		return decodeURIComponent(name.slice(19));
	} catch {
		return null;
	}
}
function withLeaseMutation(fn) {
	const run = leaseMutationQueue.then(fn, fn);
	leaseMutationQueue = run.then(() => void 0, () => void 0);
	return run;
}
function makeSession(workspace, session) {
	const ownership = session.owned ? "owned" : "borrowed";
	return {
		...session,
		contextId: currentContextId,
		ownership,
		lifecycle: getLeaseLifecycle(workspace),
		surface: ownership === "owned" ? "dedicated-container" : "borrowed-user-tab"
	};
}
function emptyRegistry() {
	return {
		version: 1,
		contextId: currentContextId,
		ownedContainerWindowId,
		ownedContainerGroupId,
		leases: {}
	};
}
async function readRegistry() {
	try {
		const local = chrome.storage?.local;
		if (!local) return emptyRegistry();
		const stored = (await local.get(REGISTRY_KEY))[REGISTRY_KEY];
		if (!stored || stored.version !== 1 || typeof stored.leases !== "object") return emptyRegistry();
		return {
			version: 1,
			contextId: currentContextId,
			ownedContainerWindowId: typeof stored.ownedContainerWindowId === "number" ? stored.ownedContainerWindowId : null,
			ownedContainerGroupId: typeof stored.ownedContainerGroupId === "number" ? stored.ownedContainerGroupId : null,
			leases: stored.leases
		};
	} catch {
		return emptyRegistry();
	}
}
async function writeRegistry(registry) {
	try {
		await chrome.storage?.local?.set({ [REGISTRY_KEY]: registry });
	} catch {}
}
async function persistRuntimeState() {
	const leases = {};
	for (const [workspace, session] of automationSessions.entries()) leases[workspace] = {
		windowId: session.windowId,
		owned: session.owned,
		preferredTabId: session.preferredTabId,
		contextId: session.contextId,
		ownership: session.ownership,
		lifecycle: session.lifecycle,
		surface: session.surface,
		idleDeadlineAt: session.idleDeadlineAt,
		updatedAt: Date.now()
	};
	await writeRegistry({
		version: 1,
		contextId: currentContextId,
		ownedContainerWindowId,
		ownedContainerGroupId,
		leases
	});
}
function scheduleIdleAlarm(workspace, timeout) {
	const alarmName = makeAlarmName(workspace);
	try {
		if (timeout > 0) chrome.alarms?.create?.(alarmName, { when: Date.now() + timeout });
		else chrome.alarms?.clear?.(alarmName);
	} catch {}
}
async function safeDetach(tabId) {
	try {
		const detach$1 = detach;
		if (typeof detach$1 === "function") await detach$1(tabId);
	} catch {}
}
async function removeWorkspaceSession(workspace) {
	const existing = automationSessions.get(workspace);
	if (existing?.idleTimer) clearTimeout(existing.idleTimer);
	automationSessions.delete(workspace);
	workspaceTimeoutOverrides.delete(workspace);
	scheduleIdleAlarm(workspace, IDLE_TIMEOUT_NONE);
	await persistRuntimeState();
}
function resetWindowIdleTimer(workspace) {
	const session = automationSessions.get(workspace);
	if (!session) return;
	if (session.idleTimer) clearTimeout(session.idleTimer);
	const timeout = getIdleTimeout(workspace);
	scheduleIdleAlarm(workspace, timeout);
	if (timeout <= 0) {
		session.idleTimer = null;
		session.idleDeadlineAt = 0;
		persistRuntimeState();
		return;
	}
	session.idleDeadlineAt = Date.now() + timeout;
	persistRuntimeState();
	session.idleTimer = setTimeout(async () => {
		await releaseWorkspaceLease(workspace, "idle timeout");
	}, timeout);
}
async function getOwnedContainerGroupId(windowId) {
	if (ownedContainerGroupId !== null) {
		try {
			if ((await chrome.tabGroups.get(ownedContainerGroupId)).windowId === windowId) return ownedContainerGroupId;
		} catch {}
		ownedContainerGroupId = null;
	}
	const existing = (await chrome.tabGroups.query({
		windowId,
		title: AUTOMATION_TAB_GROUP_TITLE
	}))[0];
	if (!existing) return null;
	ownedContainerGroupId = existing.id;
	return existing.id;
}
async function ensureOwnedContainerTabGroup(windowId, tabIds) {
	const ids = [...new Set(tabIds.filter((id) => id !== void 0))];
	if (ids.length === 0) return;
	try {
		const existingGroupId = await getOwnedContainerGroupId(windowId);
		if (existingGroupId !== null) {
			const tabs = await chrome.tabs.query({ windowId });
			const alreadyGrouped = new Set(tabs.filter((tab) => tab.id !== void 0 && ids.includes(tab.id) && tab.groupId === existingGroupId).map((tab) => tab.id));
			const missing = ids.filter((id) => !alreadyGrouped.has(id));
			if (missing.length > 0) await chrome.tabs.group({
				groupId: existingGroupId,
				tabIds: missing
			});
			return;
		}
		ownedContainerGroupId = await chrome.tabs.group({
			tabIds: ids,
			createProperties: { windowId }
		});
		await chrome.tabGroups.update(ownedContainerGroupId, {
			color: AUTOMATION_TAB_GROUP_COLOR,
			title: AUTOMATION_TAB_GROUP_TITLE,
			collapsed: false
		});
	} catch (err) {
		console.warn(`[opencli] Failed to mark automation tab group: ${err instanceof Error ? err.message : String(err)}`);
	}
}
/**
* Ensure the shared owned automation surface exists.
*
* First-principles model:
* - BrowserContext is the user's default Chrome profile.
* - Workspace identity maps to a TargetLease (usually a tab), not a window.
* - Owned TargetLeases are placed in the default dedicated-container surface.
*/
async function ensureOwnedContainerWindow(initialUrl) {
	if (ownedContainerWindowPromise) return ownedContainerWindowPromise;
	ownedContainerWindowPromise = ensureOwnedContainerWindowUnlocked(initialUrl).finally(() => {
		ownedContainerWindowPromise = null;
	});
	return ownedContainerWindowPromise;
}
async function ensureOwnedContainerWindowUnlocked(initialUrl) {
	if (ownedContainerWindowId !== null) try {
		await chrome.windows.get(ownedContainerWindowId);
		const initialTabId = await findReusableOwnedContainerTab(ownedContainerWindowId);
		await ensureOwnedContainerTabGroup(ownedContainerWindowId, [initialTabId]);
		return {
			windowId: ownedContainerWindowId,
			initialTabId
		};
	} catch {
		ownedContainerWindowId = null;
		ownedContainerGroupId = null;
	}
	const startUrl = initialUrl && isSafeNavigationUrl(initialUrl) ? initialUrl : BLANK_PAGE;
	const win = await chrome.windows.create({
		url: startUrl,
		focused: windowFocused,
		width: 1280,
		height: 900,
		type: "normal"
	});
	ownedContainerWindowId = win.id;
	console.log(`[opencli] Created owned automation container window ${ownedContainerWindowId} (start=${startUrl})`);
	const tabs = await chrome.tabs.query({ windowId: win.id });
	const initialTabId = tabs[0]?.id;
	if (initialTabId) await new Promise((resolve) => {
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
		} else chrome.tabs.onUpdated.addListener(listener);
	});
	await ensureOwnedContainerTabGroup(ownedContainerWindowId, [initialTabId]);
	await persistRuntimeState();
	return {
		windowId: ownedContainerWindowId,
		initialTabId
	};
}
async function findReusableOwnedContainerTab(windowId) {
	try {
		return (await chrome.tabs.query({ windowId })).find((tab) => tab.id !== void 0 && initialTabIsAvailable(tab.id) && isDebuggableUrl(tab.url))?.id;
	} catch {
		return;
	}
}
function initialTabIsAvailable(tabId) {
	if (tabId === void 0) return false;
	for (const session of automationSessions.values()) if (session.owned && session.preferredTabId === tabId) return false;
	return true;
}
async function createOwnedTabLease(workspace, initialUrl) {
	return withLeaseMutation(() => createOwnedTabLeaseUnlocked(workspace, initialUrl));
}
async function createOwnedTabLeaseUnlocked(workspace, initialUrl) {
	const targetUrl = initialUrl && isSafeNavigationUrl(initialUrl) ? initialUrl : BLANK_PAGE;
	const { windowId, initialTabId } = await ensureOwnedContainerWindow(targetUrl);
	let tab;
	if (initialTabIsAvailable(initialTabId)) {
		tab = await chrome.tabs.get(initialTabId);
		if (!isTargetUrl(tab.url, targetUrl)) {
			tab = await chrome.tabs.update(initialTabId, { url: targetUrl });
			await new Promise((resolve) => setTimeout(resolve, 300));
			tab = await chrome.tabs.get(initialTabId);
		}
	} else tab = await chrome.tabs.create({
		windowId,
		url: targetUrl,
		active: true
	});
	if (!tab.id) throw new Error("Failed to create tab lease in automation container");
	await ensureOwnedContainerTabGroup(windowId, [tab.id]);
	setWorkspaceSession(workspace, {
		windowId,
		owned: true,
		preferredTabId: tab.id
	});
	resetWindowIdleTimer(workspace);
	return {
		tabId: tab.id,
		tab
	};
}
/** Get or create the dedicated automation container window.
*  This compatibility helper returns the shared owned container. Workspaces
*  lease tabs inside it instead of owning separate windows.
*/
async function getAutomationWindow(workspace, initialUrl) {
	if (workspace.startsWith("bound:") && !automationSessions.has(workspace)) throw new CommandFailure("bound_session_missing", `Bound workspace "${workspace}" is not attached to a tab. Run "opencli browser bind --workspace ${workspace}" first.`, "Run bind again, then retry the browser command.");
	const existing = automationSessions.get(workspace);
	if (existing) {
		if (!existing.owned) throw new CommandFailure("bound_window_operation_blocked", `Workspace "${workspace}" is bound to a user tab and does not own an automation tab lease.`, "Use commands that operate on the bound tab, or unbind and use an automation workspace.");
		try {
			const tabId = existing.preferredTabId;
			if (tabId !== null) {
				const tab = await chrome.tabs.get(tabId);
				if (isDebuggableUrl(tab.url)) return tab.windowId;
			}
			await chrome.windows.get(existing.windowId);
			return existing.windowId;
		} catch {
			await removeWorkspaceSession(workspace);
		}
	}
	return (await ensureOwnedContainerWindow(initialUrl)).windowId;
}
chrome.windows.onRemoved.addListener(async (windowId) => {
	if (ownedContainerWindowId === windowId) {
		ownedContainerWindowId = null;
		ownedContainerGroupId = null;
	}
	for (const [workspace, session] of automationSessions.entries()) if (session.windowId === windowId) {
		console.log(`[opencli] Automation container closed (${workspace})`);
		if (session.idleTimer) clearTimeout(session.idleTimer);
		automationSessions.delete(workspace);
		workspaceTimeoutOverrides.delete(workspace);
		scheduleIdleAlarm(workspace, IDLE_TIMEOUT_NONE);
	}
	await persistRuntimeState();
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
	evictTab(tabId);
	for (const [workspace, session] of automationSessions.entries()) if (session.preferredTabId === tabId) {
		if (session.idleTimer) clearTimeout(session.idleTimer);
		automationSessions.delete(workspace);
		workspaceTimeoutOverrides.delete(workspace);
		scheduleIdleAlarm(workspace, IDLE_TIMEOUT_NONE);
		console.log(`[opencli] Workspace ${workspace} lease detached from tab ${tabId} (tab closed)`);
	}
	await persistRuntimeState();
});
var initialized = false;
function initialize() {
	if (initialized) return;
	initialized = true;
	chrome.alarms.create("keepalive", { periodInMinutes: .4 });
	registerListeners();
	registerFrameTracking();
	(async () => {
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
chrome.alarms.onAlarm.addListener(async (alarm) => {
	if (alarm.name === "keepalive") connect();
	const workspace = workspaceFromAlarmName(alarm.name);
	if (workspace) await releaseWorkspaceLease(workspace, "idle alarm");
});
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
	if (msg?.type === "getStatus") {
		(async () => {
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
/**
* Best-effort fetch of the daemon's reported version for the popup status panel.
* Resolves to null on any failure — the popup degrades to showing connection
* state without the version label.
*/
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
	const workspace = getWorkspaceKey(cmd.workspace);
	windowFocused = cmd.windowFocused === true;
	if (cmd.idleTimeout != null && cmd.idleTimeout > 0) workspaceTimeoutOverrides.set(workspace, cmd.idleTimeout * 1e3);
	resetWindowIdleTimer(workspace);
	try {
		switch (cmd.action) {
			case "exec": return await handleExec(cmd, workspace);
			case "navigate": return await handleNavigate(cmd, workspace);
			case "tabs": return await handleTabs(cmd, workspace);
			case "cookies": return await handleCookies(cmd);
			case "screenshot": return await handleScreenshot(cmd, workspace);
			case "close-window": return await handleCloseWindow(cmd, workspace);
			case "cdp": return await handleCdp(cmd, workspace);
			case "sessions": return await handleSessions(cmd);
			case "set-file-input": return await handleSetFileInput(cmd, workspace);
			case "insert-text": return await handleInsertText(cmd, workspace);
			case "bind": return await handleBind(cmd, workspace);
			case "network-capture-start": return await handleNetworkCaptureStart(cmd, workspace);
			case "network-capture-read": return await handleNetworkCaptureRead(cmd, workspace);
			case "frames": return await handleFrames(cmd, workspace);
			default: return {
				id: cmd.id,
				ok: false,
				error: `Unknown action: ${cmd.action}`
			};
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
/** Internal blank page used when no user URL is provided. */
var BLANK_PAGE = "about:blank";
/** Check if a URL can be attached via CDP — only allow http(s) and blank pages. */
function isDebuggableUrl(url) {
	if (!url) return true;
	return url.startsWith("http://") || url.startsWith("https://") || url === "about:blank" || url.startsWith("data:");
}
/** Check if a URL is safe for user-facing navigation (http/https only). */
function isSafeNavigationUrl(url) {
	return url.startsWith("http://") || url.startsWith("https://");
}
/** Minimal URL normalization for same-page comparison: root slash + default port only. */
function normalizeUrlForComparison(url) {
	if (!url) return "";
	try {
		const parsed = new URL(url);
		if (parsed.protocol === "https:" && parsed.port === "443" || parsed.protocol === "http:" && parsed.port === "80") parsed.port = "";
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
	if (cmd.matchPathPrefix) try {
		if (!new URL(tab.url).pathname.startsWith(cmd.matchPathPrefix)) return false;
	} catch {
		return false;
	}
	return true;
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
function setWorkspaceSession(workspace, session) {
	const existing = automationSessions.get(workspace);
	if (existing?.idleTimer) clearTimeout(existing.idleTimer);
	const timeout = getIdleTimeout(workspace);
	automationSessions.set(workspace, {
		...makeSession(workspace, session),
		idleTimer: null,
		idleDeadlineAt: timeout <= 0 ? 0 : Date.now() + timeout
	});
	persistRuntimeState();
}
/**
* Resolve tabId from command's page (targetId).
* Returns undefined if no page identity is provided.
*/
async function resolveCommandTabId(cmd) {
	if (cmd.page) return resolveTabId$1(cmd.page);
}
/**
* Resolve target tab for the workspace lease, returning both the tabId and
* the Tab object (when available) so callers can skip a redundant chrome.tabs.get().
*/
async function resolveTab(tabId, workspace, initialUrl) {
	const existingSession = automationSessions.get(workspace);
	if (tabId !== void 0) try {
		const tab = await chrome.tabs.get(tabId);
		const session = existingSession;
		const matchesSession = session ? session.preferredTabId !== null ? session.preferredTabId === tabId : tab.windowId === session.windowId : false;
		if (isDebuggableUrl(tab.url) && matchesSession) return {
			tabId,
			tab
		};
		if (session && !session.owned) throw new CommandFailure(matchesSession ? "bound_tab_not_debuggable" : "bound_tab_mismatch", matchesSession ? `Bound tab for workspace "${workspace}" is not debuggable (${tab.url ?? "unknown URL"}).` : `Target tab is not the tab bound to workspace "${workspace}".`, "Run \"opencli browser bind\" again on a debuggable http(s) tab.");
		if (session && !matchesSession && session.preferredTabId === null && isDebuggableUrl(tab.url)) {
			console.warn(`[opencli] Tab ${tabId} drifted to window ${tab.windowId}, moving back to ${session.windowId}`);
			try {
				await chrome.tabs.move(tabId, {
					windowId: session.windowId,
					index: -1
				});
				const moved = await chrome.tabs.get(tabId);
				if (moved.windowId === session.windowId && isDebuggableUrl(moved.url)) return {
					tabId,
					tab: moved
				};
			} catch (moveErr) {
				console.warn(`[opencli] Failed to move tab back: ${moveErr}`);
			}
		} else if (!isDebuggableUrl(tab.url)) console.warn(`[opencli] Tab ${tabId} URL is not debuggable (${tab.url}), re-resolving`);
	} catch (err) {
		if (err instanceof CommandFailure) throw err;
		if (existingSession && !existingSession.owned) {
			automationSessions.delete(workspace);
			throw new CommandFailure("bound_tab_gone", `Bound tab for workspace "${workspace}" no longer exists.`, "Run \"opencli browser bind\" again, then retry the command.");
		}
		console.warn(`[opencli] Tab ${tabId} no longer exists, re-resolving`);
	}
	const existingPreferredTabId = existingSession?.preferredTabId ?? null;
	if (existingSession && existingPreferredTabId !== null) {
		const session = existingSession;
		try {
			const preferredTab = await chrome.tabs.get(existingPreferredTabId);
			if (isDebuggableUrl(preferredTab.url)) return {
				tabId: preferredTab.id,
				tab: preferredTab
			};
			if (!session.owned) throw new CommandFailure("bound_tab_not_debuggable", `Bound tab for workspace "${workspace}" is not debuggable (${preferredTab.url ?? "unknown URL"}).`, "Switch the tab to an http(s) page or run \"opencli browser bind\" on another tab.");
		} catch (err) {
			if (err instanceof CommandFailure) throw err;
			await removeWorkspaceSession(workspace);
			if (!session.owned) throw new CommandFailure("bound_tab_gone", `Bound tab for workspace "${workspace}" no longer exists.`, "Run \"opencli browser bind\" again, then retry the command.");
			return createOwnedTabLease(workspace, initialUrl);
		}
	}
	if (!existingSession && workspace.startsWith("bound:")) await getAutomationWindow(workspace, initialUrl);
	if (!existingSession || existingSession.owned && existingSession.preferredTabId === null) return createOwnedTabLease(workspace, initialUrl);
	const windowId = await getAutomationWindow(workspace, initialUrl);
	const tabs = await chrome.tabs.query({ windowId });
	const debuggableTab = tabs.find((t) => t.id && isDebuggableUrl(t.url));
	if (debuggableTab?.id) return {
		tabId: debuggableTab.id,
		tab: debuggableTab
	};
	const reuseTab = tabs.find((t) => t.id);
	if (reuseTab?.id) {
		await chrome.tabs.update(reuseTab.id, { url: BLANK_PAGE });
		await new Promise((resolve) => setTimeout(resolve, 300));
		try {
			const updated = await chrome.tabs.get(reuseTab.id);
			if (isDebuggableUrl(updated.url)) return {
				tabId: reuseTab.id,
				tab: updated
			};
			console.warn(`[opencli] data: URI was intercepted (${updated.url}), creating fresh tab`);
		} catch {}
	}
	const newTab = await chrome.tabs.create({
		windowId,
		url: BLANK_PAGE,
		active: true
	});
	if (!newTab.id) throw new Error("Failed to create tab in automation container");
	return {
		tabId: newTab.id,
		tab: newTab
	};
}
/** Build a page-scoped success result with targetId resolved from tabId */
async function pageScopedResult(id, tabId, data) {
	return {
		id,
		ok: true,
		data,
		page: await resolveTargetId(tabId)
	};
}
/** Convenience wrapper returning just the tabId (used by most handlers) */
async function resolveTabId(tabId, workspace, initialUrl) {
	return (await resolveTab(tabId, workspace, initialUrl)).tabId;
}
async function listAutomationTabs(workspace) {
	const session = automationSessions.get(workspace);
	if (!session) return [];
	if (session.preferredTabId !== null) try {
		return [await chrome.tabs.get(session.preferredTabId)];
	} catch {
		automationSessions.delete(workspace);
		return [];
	}
	try {
		return await chrome.tabs.query({ windowId: session.windowId });
	} catch {
		automationSessions.delete(workspace);
		return [];
	}
}
async function listAutomationWebTabs(workspace) {
	return (await listAutomationTabs(workspace)).filter((tab) => isDebuggableUrl(tab.url));
}
async function handleExec(cmd, workspace) {
	if (!cmd.code) return {
		id: cmd.id,
		ok: false,
		error: "Missing code"
	};
	const tabId = await resolveTabId(await resolveCommandTabId(cmd), workspace);
	try {
		const aggressive = workspace.startsWith("browser:") || workspace.startsWith("operate:");
		if (cmd.frameIndex != null) {
			const frames = enumerateCrossOriginFrames(await getFrameTree(tabId));
			if (cmd.frameIndex < 0 || cmd.frameIndex >= frames.length) return {
				id: cmd.id,
				ok: false,
				error: `Frame index ${cmd.frameIndex} out of range (${frames.length} cross-origin frames available)`
			};
			const data = await evaluateInFrame(tabId, cmd.code, frames[cmd.frameIndex].frameId, aggressive);
			return pageScopedResult(cmd.id, tabId, data);
		}
		const data = await evaluateAsync(tabId, cmd.code, aggressive);
		return pageScopedResult(cmd.id, tabId, data);
	} catch (err) {
		return {
			id: cmd.id,
			ok: false,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}
async function handleFrames(cmd, workspace) {
	const tabId = await resolveTabId(await resolveCommandTabId(cmd), workspace);
	try {
		const tree = await getFrameTree(tabId);
		return {
			id: cmd.id,
			ok: true,
			data: enumerateCrossOriginFrames(tree)
		};
	} catch (err) {
		return {
			id: cmd.id,
			ok: false,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}
async function handleNavigate(cmd, workspace) {
	if (!cmd.url) return {
		id: cmd.id,
		ok: false,
		error: "Missing url"
	};
	if (!isSafeNavigationUrl(cmd.url)) return {
		id: cmd.id,
		ok: false,
		error: "Blocked URL scheme -- only http:// and https:// are allowed"
	};
	const session = automationSessions.get(workspace);
	if (session && !session.owned && cmd.allowBoundNavigation !== true) return {
		id: cmd.id,
		ok: false,
		errorCode: "bound_navigation_blocked",
		error: `Workspace "${workspace}" is bound to a user tab; navigation is blocked by default.`,
		errorHint: "Pass --allow-navigate-bound only if you intentionally want to navigate the bound tab."
	};
	const resolved = await resolveTab(await resolveCommandTabId(cmd), workspace, cmd.url);
	const tabId = resolved.tabId;
	const beforeTab = resolved.tab ?? await chrome.tabs.get(tabId);
	const beforeNormalized = normalizeUrlForComparison(beforeTab.url);
	const targetUrl = cmd.url;
	if (beforeTab.status === "complete" && isTargetUrl(beforeTab.url, targetUrl)) return pageScopedResult(cmd.id, tabId, {
		title: beforeTab.title,
		url: beforeTab.url,
		timedOut: false
	});
	if (!hasActiveNetworkCapture(tabId)) await detach(tabId);
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
		const listener = (id, info, tab) => {
			if (id !== tabId) return;
			if (info.status === "complete" && isNavigationDone(tab.url ?? info.url)) finish();
		};
		chrome.tabs.onUpdated.addListener(listener);
		checkTimer = setTimeout(async () => {
			try {
				const currentTab = await chrome.tabs.get(tabId);
				if (currentTab.status === "complete" && isNavigationDone(currentTab.url)) finish();
			} catch {}
		}, 100);
		timeoutTimer = setTimeout(() => {
			timedOut = true;
			console.warn(`[opencli] Navigate to ${targetUrl} timed out after 15s`);
			finish();
		}, 15e3);
	});
	let tab = await chrome.tabs.get(tabId);
	const postNavigationSession = automationSessions.get(workspace);
	if (postNavigationSession?.owned === false && tab.windowId !== postNavigationSession.windowId) return {
		id: cmd.id,
		ok: false,
		errorCode: "bound_tab_moved",
		error: `Bound tab for workspace "${workspace}" moved to another window during navigation.`,
		errorHint: "Run \"opencli browser bind\" again on the intended tab."
	};
	if (postNavigationSession && tab.windowId !== postNavigationSession.windowId) {
		console.warn(`[opencli] Tab ${tabId} drifted to window ${tab.windowId} during navigation, moving back to ${postNavigationSession.windowId}`);
		try {
			await chrome.tabs.move(tabId, {
				windowId: postNavigationSession.windowId,
				index: -1
			});
			tab = await chrome.tabs.get(tabId);
		} catch (moveErr) {
			console.warn(`[opencli] Failed to recover drifted tab: ${moveErr}`);
		}
	}
	return pageScopedResult(cmd.id, tabId, {
		title: tab.title,
		url: tab.url,
		timedOut
	});
}
async function handleTabs(cmd, workspace) {
	const session = automationSessions.get(workspace);
	if (session && !session.owned && cmd.op !== "list") return {
		id: cmd.id,
		ok: false,
		errorCode: "bound_tab_mutation_blocked",
		error: `Workspace "${workspace}" is bound to a user tab; tab mutation is blocked by default.`,
		errorHint: "Use an automation workspace for tab new/select/close, or unbind first."
	};
	switch (cmd.op) {
		case "list": {
			const tabs = await listAutomationWebTabs(workspace);
			const data = await Promise.all(tabs.map(async (t, i) => {
				let page;
				try {
					page = t.id ? await resolveTargetId(t.id) : void 0;
				} catch {}
				return {
					index: i,
					page,
					url: t.url,
					title: t.title,
					active: t.active
				};
			}));
			return {
				id: cmd.id,
				ok: true,
				data
			};
		}
		case "new": {
			if (cmd.url && !isSafeNavigationUrl(cmd.url)) return {
				id: cmd.id,
				ok: false,
				error: "Blocked URL scheme -- only http:// and https:// are allowed"
			};
			if (!automationSessions.has(workspace)) {
				const created = await createOwnedTabLease(workspace, cmd.url);
				return pageScopedResult(cmd.id, created.tabId, { url: created.tab?.url });
			}
			const windowId = await getAutomationWindow(workspace);
			const tab = await chrome.tabs.create({
				windowId,
				url: cmd.url ?? BLANK_PAGE,
				active: true
			});
			if (!tab.id) return {
				id: cmd.id,
				ok: false,
				error: "Failed to create tab"
			};
			await ensureOwnedContainerTabGroup(windowId, [tab.id]);
			setWorkspaceSession(workspace, {
				windowId: tab.windowId,
				owned: true,
				preferredTabId: tab.id
			});
			resetWindowIdleTimer(workspace);
			return pageScopedResult(cmd.id, tab.id, { url: tab.url });
		}
		case "close": {
			if (cmd.index !== void 0) {
				const target = (await listAutomationWebTabs(workspace))[cmd.index];
				if (!target?.id) return {
					id: cmd.id,
					ok: false,
					error: `Tab index ${cmd.index} not found`
				};
				const closedPage = await resolveTargetId(target.id).catch(() => void 0);
				if (automationSessions.get(workspace)?.preferredTabId === target.id) await releaseWorkspaceLease(workspace, "tab close");
				else {
					await safeDetach(target.id);
					await chrome.tabs.remove(target.id);
				}
				return {
					id: cmd.id,
					ok: true,
					data: { closed: closedPage }
				};
			}
			const tabId = await resolveTabId(await resolveCommandTabId(cmd), workspace);
			const closedPage = await resolveTargetId(tabId).catch(() => void 0);
			if (automationSessions.get(workspace)?.preferredTabId === tabId) await releaseWorkspaceLease(workspace, "tab close");
			else {
				await safeDetach(tabId);
				await chrome.tabs.remove(tabId);
			}
			return {
				id: cmd.id,
				ok: true,
				data: { closed: closedPage }
			};
		}
		case "select": {
			if (cmd.index === void 0 && cmd.page === void 0) return {
				id: cmd.id,
				ok: false,
				error: "Missing index or page"
			};
			const cmdTabId = await resolveCommandTabId(cmd);
			if (cmdTabId !== void 0) {
				const session = automationSessions.get(workspace);
				let tab;
				try {
					tab = await chrome.tabs.get(cmdTabId);
				} catch {
					return {
						id: cmd.id,
						ok: false,
						error: `Page no longer exists`
					};
				}
				if (!session || tab.windowId !== session.windowId) return {
					id: cmd.id,
					ok: false,
					error: `Page is not in the automation container`
				};
				await chrome.tabs.update(cmdTabId, { active: true });
				return pageScopedResult(cmd.id, cmdTabId, { selected: true });
			}
			const target = (await listAutomationWebTabs(workspace))[cmd.index];
			if (!target?.id) return {
				id: cmd.id,
				ok: false,
				error: `Tab index ${cmd.index} not found`
			};
			await chrome.tabs.update(target.id, { active: true });
			return pageScopedResult(cmd.id, target.id, { selected: true });
		}
		default: return {
			id: cmd.id,
			ok: false,
			error: `Unknown tabs op: ${cmd.op}`
		};
	}
}
async function handleCookies(cmd) {
	if (!cmd.domain && !cmd.url) return {
		id: cmd.id,
		ok: false,
		error: "Cookie scope required: provide domain or url to avoid dumping all cookies"
	};
	const details = {};
	if (cmd.domain) details.domain = cmd.domain;
	if (cmd.url) details.url = cmd.url;
	const data = (await chrome.cookies.getAll(details)).map((c) => ({
		name: c.name,
		value: c.value,
		domain: c.domain,
		path: c.path,
		secure: c.secure,
		httpOnly: c.httpOnly,
		expirationDate: c.expirationDate
	}));
	return {
		id: cmd.id,
		ok: true,
		data
	};
}
async function handleScreenshot(cmd, workspace) {
	const tabId = await resolveTabId(await resolveCommandTabId(cmd), workspace);
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
		return {
			id: cmd.id,
			ok: false,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}
/** CDP methods permitted via the 'cdp' passthrough action. */
var CDP_ALLOWLIST = new Set([
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
	"Input.dispatchMouseEvent",
	"Input.dispatchKeyEvent",
	"Input.insertText",
	"Page.getLayoutMetrics",
	"Page.captureScreenshot",
	"Page.getFrameTree",
	"Page.handleJavaScriptDialog",
	"Runtime.enable",
	"Emulation.setDeviceMetricsOverride",
	"Emulation.clearDeviceMetricsOverride"
]);
async function handleCdp(cmd, workspace) {
	if (!cmd.cdpMethod) return {
		id: cmd.id,
		ok: false,
		error: "Missing cdpMethod"
	};
	if (!CDP_ALLOWLIST.has(cmd.cdpMethod)) return {
		id: cmd.id,
		ok: false,
		error: `CDP method not permitted: ${cmd.cdpMethod}`
	};
	const tabId = await resolveTabId(await resolveCommandTabId(cmd), workspace);
	try {
		await ensureAttached(tabId, workspace.startsWith("browser:") || workspace.startsWith("operate:"));
		const data = await chrome.debugger.sendCommand({ tabId }, cmd.cdpMethod, cmd.cdpParams ?? {});
		return pageScopedResult(cmd.id, tabId, data);
	} catch (err) {
		return {
			id: cmd.id,
			ok: false,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}
async function handleCloseWindow(cmd, workspace) {
	await releaseWorkspaceLease(workspace, "explicit close");
	return {
		id: cmd.id,
		ok: true,
		data: {
			closed: true,
			workspace
		}
	};
}
async function handleSetFileInput(cmd, workspace) {
	if (!cmd.files || !Array.isArray(cmd.files) || cmd.files.length === 0) return {
		id: cmd.id,
		ok: false,
		error: "Missing or empty files array"
	};
	const tabId = await resolveTabId(await resolveCommandTabId(cmd), workspace);
	try {
		await setFileInputFiles(tabId, cmd.files, cmd.selector);
		return pageScopedResult(cmd.id, tabId, { count: cmd.files.length });
	} catch (err) {
		return {
			id: cmd.id,
			ok: false,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}
async function handleInsertText(cmd, workspace) {
	if (typeof cmd.text !== "string") return {
		id: cmd.id,
		ok: false,
		error: "Missing text payload"
	};
	const tabId = await resolveTabId(await resolveCommandTabId(cmd), workspace);
	try {
		await insertText(tabId, cmd.text);
		return pageScopedResult(cmd.id, tabId, { inserted: true });
	} catch (err) {
		return {
			id: cmd.id,
			ok: false,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}
async function handleNetworkCaptureStart(cmd, workspace) {
	const tabId = await resolveTabId(await resolveCommandTabId(cmd), workspace);
	try {
		await startNetworkCapture(tabId, cmd.pattern);
		return pageScopedResult(cmd.id, tabId, { started: true });
	} catch (err) {
		return {
			id: cmd.id,
			ok: false,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}
async function handleNetworkCaptureRead(cmd, workspace) {
	const tabId = await resolveTabId(await resolveCommandTabId(cmd), workspace);
	try {
		const data = await readNetworkCapture(tabId);
		return pageScopedResult(cmd.id, tabId, data);
	} catch (err) {
		return {
			id: cmd.id,
			ok: false,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}
async function releaseWorkspaceLease(workspace, reason = "released") {
	const session = automationSessions.get(workspace);
	if (!session) {
		workspaceTimeoutOverrides.delete(workspace);
		scheduleIdleAlarm(workspace, IDLE_TIMEOUT_NONE);
		await persistRuntimeState();
		return;
	}
	if (session.idleTimer) clearTimeout(session.idleTimer);
	scheduleIdleAlarm(workspace, IDLE_TIMEOUT_NONE);
	if (session.owned) {
		const tabId = session.preferredTabId;
		if (tabId !== null) {
			const hasOtherOwnedLease = [...automationSessions.entries()].some(([otherWorkspace, otherSession]) => otherWorkspace !== workspace && otherSession.owned && otherSession.windowId === session.windowId && otherSession.preferredTabId !== null);
			await safeDetach(tabId);
			evictTab(tabId);
			if (hasOtherOwnedLease) {
				await chrome.tabs.remove(tabId).catch(() => {});
				console.log(`[opencli] Released owned tab lease ${tabId} (${workspace}, ${reason})`);
			} else try {
				const tab = await chrome.tabs.update(tabId, {
					url: BLANK_PAGE,
					active: true
				});
				await ensureOwnedContainerTabGroup(session.windowId, [tab.id ?? tabId]);
				console.log(`[opencli] Released owned tab lease ${tabId} as reusable placeholder (${workspace}, ${reason})`);
			} catch {
				await chrome.tabs.remove(tabId).catch(() => {});
				console.log(`[opencli] Released owned tab lease ${tabId} (${workspace}, ${reason})`);
			}
		} else console.log(`[opencli] Released legacy owned window lease ${session.windowId} without closing container (${workspace}, ${reason})`);
	} else if (session.preferredTabId !== null) {
		await safeDetach(session.preferredTabId);
		console.log(`[opencli] Detached borrowed tab lease ${session.preferredTabId} (${workspace}, ${reason})`);
	}
	automationSessions.delete(workspace);
	workspaceTimeoutOverrides.delete(workspace);
	await persistRuntimeState();
}
async function reconcileTargetLeaseRegistry() {
	const registry = await readRegistry();
	ownedContainerWindowId = registry.ownedContainerWindowId;
	ownedContainerGroupId = registry.ownedContainerGroupId ?? null;
	if (ownedContainerWindowId !== null) try {
		await chrome.windows.get(ownedContainerWindowId);
	} catch {
		ownedContainerWindowId = null;
		ownedContainerGroupId = null;
	}
	automationSessions.clear();
	for (const [workspace, stored] of Object.entries(registry.leases)) {
		const tabId = stored.preferredTabId;
		if (tabId === null) continue;
		try {
			const tab = await chrome.tabs.get(tabId);
			if (!isDebuggableUrl(tab.url)) continue;
			const session = makeSession(workspace, {
				windowId: tab.windowId,
				owned: stored.owned,
				preferredTabId: tabId
			});
			const timeout = getIdleTimeout(workspace);
			automationSessions.set(workspace, {
				...session,
				idleTimer: null,
				idleDeadlineAt: stored.idleDeadlineAt
			});
			if (session.owned && ownedContainerWindowId === null) ownedContainerWindowId = tab.windowId;
			if (session.owned) await ensureOwnedContainerTabGroup(tab.windowId, [tabId]);
			const remaining = stored.idleDeadlineAt > 0 ? stored.idleDeadlineAt - Date.now() : timeout;
			if (timeout > 0) if (remaining <= 0) await releaseWorkspaceLease(workspace, "reconciled idle expiry");
			else resetWindowIdleTimer(workspace);
		} catch {}
	}
	await persistRuntimeState();
}
async function handleSessions(cmd) {
	const now = Date.now();
	const data = await Promise.all([...automationSessions.entries()].map(async ([workspace, session]) => ({
		workspace,
		windowId: session.windowId,
		owned: session.owned,
		preferredTabId: session.preferredTabId,
		contextId: session.contextId,
		ownership: session.ownership,
		lifecycle: session.lifecycle,
		surface: session.surface,
		tabCount: session.preferredTabId !== null ? await chrome.tabs.get(session.preferredTabId).then((tab) => isDebuggableUrl(tab.url) ? 1 : 0).catch(() => 0) : (await chrome.tabs.query({ windowId: session.windowId })).filter((tab) => isDebuggableUrl(tab.url)).length,
		idleMsRemaining: session.idleDeadlineAt <= 0 ? null : Math.max(0, session.idleDeadlineAt - now)
	})));
	return {
		id: cmd.id,
		ok: true,
		data
	};
}
async function handleBind(cmd, workspace) {
	if (!workspace.startsWith("bound:")) return {
		id: cmd.id,
		ok: false,
		errorCode: "invalid_bind_workspace",
		error: `bind workspace must start with "bound:", got "${workspace}".`,
		errorHint: "Use the default \"bound:default\" or pass --workspace bound:<name>."
	};
	const existing = automationSessions.get(workspace);
	if (existing?.owned) return {
		id: cmd.id,
		ok: false,
		errorCode: "invalid_bind_workspace",
		error: `Workspace "${workspace}" already owns an automation tab lease and cannot be rebound to a user tab.`,
		errorHint: "Use a fresh bound:<name> workspace, or close/unbind the existing session first."
	};
	const activeTabs = await chrome.tabs.query({
		active: true,
		lastFocusedWindow: true
	});
	const fallbackTabs = await chrome.tabs.query({ lastFocusedWindow: true });
	const boundTab = activeTabs.find((tab) => matchesBindCriteria(tab, cmd)) ?? fallbackTabs.find((tab) => matchesBindCriteria(tab, cmd));
	if (!boundTab?.id) return {
		id: cmd.id,
		ok: false,
		errorCode: "bound_tab_not_found",
		error: cmd.matchDomain || cmd.matchPathPrefix ? `No visible tab in the current window matching ${cmd.matchDomain ?? "domain"}${cmd.matchPathPrefix ? ` ${cmd.matchPathPrefix}` : ""}` : "No debuggable tab found in the current window",
		errorHint: "Focus the target Chrome tab/window or relax --domain / --path-prefix, then retry bind."
	};
	if (existing && !existing.owned && existing.preferredTabId !== null && existing.preferredTabId !== boundTab.id) await detach(existing.preferredTabId).catch(() => {});
	setWorkspaceSession(workspace, {
		windowId: boundTab.windowId,
		owned: false,
		preferredTabId: boundTab.id
	});
	resetWindowIdleTimer(workspace);
	console.log(`[opencli] Workspace ${workspace} explicitly bound to tab ${boundTab.id} (${boundTab.url})`);
	return pageScopedResult(cmd.id, boundTab.id, {
		url: boundTab.url,
		title: boundTab.title,
		workspace
	});
}
//#endregion
