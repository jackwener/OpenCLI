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
	if (options.fullPage) {
		const metrics = await chrome.debugger.sendCommand({ tabId }, "Page.getLayoutMetrics");
		const size = metrics.cssContentSize || metrics.contentSize;
		if (size) await chrome.debugger.sendCommand({ tabId }, "Emulation.setDeviceMetricsOverride", {
			mobile: false,
			width: Math.ceil(size.width),
			height: Math.ceil(size.height),
			deviceScaleFactor: 1
		});
	}
	try {
		const params = { format };
		if (format === "jpeg" && options.quality !== void 0) params.quality = Math.max(0, Math.min(100, options.quality));
		return (await chrome.debugger.sendCommand({ tabId }, "Page.captureScreenshot", params)).data;
	} finally {
		if (options.fullPage) await chrome.debugger.sendCommand({ tabId }, "Emulation.clearDeviceMetricsOverride").catch(() => {});
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
	try {
		await chrome.debugger.detach({ tabId });
	} catch {}
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
		if (info.url && !isDebuggableUrl$1(info.url)) await detach(tabId);
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
			} catch {}
			return;
		}
		if (method === "Network.responseReceived") {
			const requestId = String(params?.requestId || "");
			const response = params?.response;
			const entry = getOrCreateNetworkCaptureEntry(tabId, requestId, { url: response?.url });
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
				if (typeof body?.body === "string") entry.responsePreview = body.base64Encoded ? `base64:${body.body.slice(0, 4e3)}` : body.body.slice(0, 4e3);
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
		ws?.send(JSON.stringify({
			type: "hello",
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
var IDLE_TIMEOUT_DEFAULT = 3e4;
var IDLE_TIMEOUT_INTERACTIVE = 6e5;
/** Per-workspace custom timeout overrides set via command.idleTimeout */
var workspaceTimeoutOverrides = /* @__PURE__ */ new Map();
function getIdleTimeout(workspace) {
	const override = workspaceTimeoutOverrides.get(workspace);
	if (override !== void 0) return override;
	if (workspace.startsWith("browser:") || workspace.startsWith("operate:")) return IDLE_TIMEOUT_INTERACTIVE;
	return IDLE_TIMEOUT_DEFAULT;
}
var windowFocused = false;
function getWorkspaceKey(workspace) {
	return workspace?.trim() || "default";
}
function resetWindowIdleTimer(workspace) {
	const session = automationSessions.get(workspace);
	if (!session) return;
	if (session.idleTimer) clearTimeout(session.idleTimer);
	const timeout = getIdleTimeout(workspace);
	session.idleDeadlineAt = Date.now() + timeout;
	session.idleTimer = setTimeout(async () => {
		const current = automationSessions.get(workspace);
		if (!current) return;
		if (!current.owned) {
			console.log(`[opencli] Borrowed workspace ${workspace} detached from window ${current.windowId} (idle timeout)`);
			workspaceTimeoutOverrides.delete(workspace);
			automationSessions.delete(workspace);
			return;
		}
		try {
			await chrome.windows.remove(current.windowId);
			console.log(`[opencli] Automation window ${current.windowId} (${workspace}) closed (idle timeout, ${timeout / 1e3}s)`);
		} catch {}
		workspaceTimeoutOverrides.delete(workspace);
		automationSessions.delete(workspace);
	}, timeout);
}
/** Get or create the dedicated automation window.
*  @param initialUrl — if provided (http/https), used as the initial page instead of about:blank.
*    This avoids an extra blank-page→target-domain navigation on first command.
*/
async function getAutomationWindow(workspace, initialUrl) {
	const existing = automationSessions.get(workspace);
	if (existing) try {
		await chrome.windows.get(existing.windowId);
		return existing.windowId;
	} catch {
		automationSessions.delete(workspace);
	}
	const startUrl = initialUrl && isSafeNavigationUrl(initialUrl) ? initialUrl : BLANK_PAGE;
	const win = await chrome.windows.create({
		url: startUrl,
		focused: windowFocused,
		width: 1280,
		height: 900,
		type: "normal"
	});
	const session = {
		windowId: win.id,
		idleTimer: null,
		idleDeadlineAt: Date.now() + getIdleTimeout(workspace),
		owned: true,
		preferredTabId: null
	};
	automationSessions.set(workspace, session);
	console.log(`[opencli] Created automation window ${session.windowId} (${workspace}, start=${startUrl})`);
	resetWindowIdleTimer(workspace);
	const tabs = await chrome.tabs.query({ windowId: win.id });
	if (tabs[0]?.id) await new Promise((resolve) => {
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
		} else chrome.tabs.onUpdated.addListener(listener);
	});
	return session.windowId;
}
chrome.windows.onRemoved.addListener(async (windowId) => {
	for (const [workspace, session] of automationSessions.entries()) if (session.windowId === windowId) {
		console.log(`[opencli] Automation window closed (${workspace})`);
		if (session.idleTimer) clearTimeout(session.idleTimer);
		automationSessions.delete(workspace);
		workspaceTimeoutOverrides.delete(workspace);
	}
});
chrome.tabs.onRemoved.addListener((tabId) => {
	evictTab(tabId);
});
var initialized = false;
function initialize() {
	if (initialized) return;
	initialized = true;
	chrome.alarms.create("keepalive", { periodInMinutes: .4 });
	registerListeners();
	connect();
	console.log("[opencli] OpenCLI extension initialized");
}
chrome.runtime.onInstalled.addListener(() => {
	initialize();
});
chrome.runtime.onStartup.addListener(() => {
	initialize();
});
chrome.alarms.onAlarm.addListener((alarm) => {
	if (alarm.name === "keepalive") connect();
});
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
	if (msg?.type === "getStatus") sendResponse({
		connected: ws?.readyState === WebSocket.OPEN,
		reconnecting: reconnectTimer !== null
	});
	return false;
});
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
			case "bind-current": return await handleBindCurrent(cmd, workspace);
			case "network-capture-start": return await handleNetworkCaptureStart(cmd, workspace);
			case "network-capture-read": return await handleNetworkCaptureRead(cmd, workspace);
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
			error: err instanceof Error ? err.message : String(err)
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
function setWorkspaceSession(workspace, session) {
	const existing = automationSessions.get(workspace);
	if (existing?.idleTimer) clearTimeout(existing.idleTimer);
	automationSessions.set(workspace, {
		...session,
		idleTimer: null,
		idleDeadlineAt: Date.now() + getIdleTimeout(workspace)
	});
}
/**
* Resolve tabId from command's page (targetId).
* Returns undefined if no page identity is provided.
*/
async function resolveCommandTabId(cmd) {
	if (cmd.page) return resolveTabId$1(cmd.page);
}
/**
* Resolve target tab in the automation window, returning both the tabId and
* the Tab object (when available) so callers can skip a redundant chrome.tabs.get().
*/
async function resolveTab(tabId, workspace, initialUrl) {
	if (tabId !== void 0) try {
		const tab = await chrome.tabs.get(tabId);
		const session = automationSessions.get(workspace);
		const matchesSession = session ? session.preferredTabId !== null ? session.preferredTabId === tabId : tab.windowId === session.windowId : false;
		if (isDebuggableUrl(tab.url) && matchesSession) return {
			tabId,
			tab
		};
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
	} catch {
		console.warn(`[opencli] Tab ${tabId} no longer exists, re-resolving`);
	}
	const existingSession = automationSessions.get(workspace);
	if (existingSession?.preferredTabId !== null) try {
		const preferredTab = await chrome.tabs.get(existingSession.preferredTabId);
		if (isDebuggableUrl(preferredTab.url)) return {
			tabId: preferredTab.id,
			tab: preferredTab
		};
	} catch {
		automationSessions.delete(workspace);
	}
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
	if (!newTab.id) throw new Error("Failed to create tab in automation window");
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
	const session = automationSessions.get(workspace);
	if (session && tab.windowId !== session.windowId) {
		console.warn(`[opencli] Tab ${tabId} drifted to window ${tab.windowId} during navigation, moving back to ${session.windowId}`);
		try {
			await chrome.tabs.move(tabId, {
				windowId: session.windowId,
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
				await chrome.tabs.remove(target.id);
				await detach(target.id);
				return {
					id: cmd.id,
					ok: true,
					data: { closed: closedPage }
				};
			}
			const tabId = await resolveTabId(await resolveCommandTabId(cmd), workspace);
			const closedPage = await resolveTargetId(tabId).catch(() => void 0);
			await chrome.tabs.remove(tabId);
			await detach(tabId);
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
					error: `Page is not in the automation window`
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
			fullPage: cmd.fullPage
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
	"DOM.getDocument",
	"DOM.getBoxModel",
	"DOM.getContentQuads",
	"DOM.querySelectorAll",
	"DOM.scrollIntoViewIfNeeded",
	"DOMSnapshot.captureSnapshot",
	"Input.dispatchMouseEvent",
	"Input.dispatchKeyEvent",
	"Input.insertText",
	"Page.getLayoutMetrics",
	"Page.captureScreenshot",
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
	const session = automationSessions.get(workspace);
	if (session) {
		if (session.owned) try {
			await chrome.windows.remove(session.windowId);
		} catch {}
		if (session.idleTimer) clearTimeout(session.idleTimer);
		workspaceTimeoutOverrides.delete(workspace);
		automationSessions.delete(workspace);
	}
	return {
		id: cmd.id,
		ok: true,
		data: { closed: true }
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
async function handleSessions(cmd) {
	const now = Date.now();
	const data = await Promise.all([...automationSessions.entries()].map(async ([workspace, session]) => ({
		workspace,
		windowId: session.windowId,
		tabCount: (await chrome.tabs.query({ windowId: session.windowId })).filter((tab) => isDebuggableUrl(tab.url)).length,
		idleMsRemaining: Math.max(0, session.idleDeadlineAt - now)
	})));
	return {
		id: cmd.id,
		ok: true,
		data
	};
}
async function handleBindCurrent(cmd, workspace) {
	const activeTabs = await chrome.tabs.query({
		active: true,
		lastFocusedWindow: true
	});
	const fallbackTabs = await chrome.tabs.query({ lastFocusedWindow: true });
	const allTabs = await chrome.tabs.query({});
	const boundTab = activeTabs.find((tab) => matchesBindCriteria(tab, cmd)) ?? fallbackTabs.find((tab) => matchesBindCriteria(tab, cmd)) ?? allTabs.find((tab) => matchesBindCriteria(tab, cmd));
	if (!boundTab?.id) return {
		id: cmd.id,
		ok: false,
		error: cmd.matchDomain || cmd.matchPathPrefix ? `No visible tab matching ${cmd.matchDomain ?? "domain"}${cmd.matchPathPrefix ? ` ${cmd.matchPathPrefix}` : ""}` : "No active debuggable tab found"
	};
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
