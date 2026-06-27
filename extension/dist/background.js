//#region src/protocol.ts
/** Default daemon port */
var DAEMON_PORT = 19825;
var DAEMON_HOST = "localhost";
var DAEMON_WS_URL = `ws://${DAEMON_HOST}:${DAEMON_PORT}/ext`;
/** Lightweight health-check endpoint — probed before each WebSocket attempt. */
var DAEMON_PING_URL = `http://${DAEMON_HOST}:${DAEMON_PORT}/ping`;
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
var frameTargets = /* @__PURE__ */ new Map();
var frameTargetKeys = /* @__PURE__ */ new Map();
var frameTargetCleanupRegistered = false;
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
function matchesDownloadPattern(item, pattern) {
	if (!pattern) return true;
	return [
		item.filename,
		item.url,
		item.finalUrl,
		item.mime
	].filter(Boolean).join("\n").toLowerCase().includes(pattern.toLowerCase());
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
			const item = (await chrome.downloads.search({ id }))[0];
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
				inspectById(delta.id);
				return;
			}
			if (delta.state?.current === "complete" || delta.state?.current === "interrupted") inspectById(delta.id);
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
		chrome.downloads.search({
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
			for (const item of recent) if (item.state === "in_progress" && matchesDownloadPattern(item, pattern)) inProgressIds.add(item.id);
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
		if (method === "Target.detachedFromTarget") clearFrameTarget(String(params?.targetId || ""));
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
	await chrome.debugger.sendCommand({ tabId }, "Target.setDiscoverTargets", { discover: true }).catch(() => {});
	await chrome.debugger.sendCommand({ tabId }, "Target.setAutoAttach", {
		autoAttach: true,
		waitForDebuggerOnStart: false,
		flatten: true,
		filter: [{
			type: "iframe",
			exclude: false
		}]
	}).catch(() => {});
	const targetId = await resolveFrameTargetId(tabId, frameId, targetUrl);
	try {
		await chrome.debugger.attach({ targetId }, "1.3");
	} catch (err) {
		if (!(err instanceof Error ? err.message : String(err)).includes("Another debugger is already attached")) throw err;
	}
	frameTargets.set(key, targetId);
	frameTargetKeys.set(targetId, key);
	return targetId;
}
async function resolveFrameTargetId(tabId, frameId, targetUrl) {
	const targets = (await chrome.debugger.sendCommand({ tabId }, "Target.getTargets").catch(() => null))?.targetInfos ?? [];
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
	const target = { targetId: await ensureFrameTarget(tabId, frameId, aggressiveRetry, targetUrl) };
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
	if (contextId === void 0) {
		await sendCommandInFrameTarget(tabId, frameId, "Runtime.enable", {}, aggressiveRetry).catch(() => void 0);
		const result = await sendCommandInFrameTarget(tabId, frameId, "Runtime.evaluate", {
			expression,
			returnByValue: true,
			awaitPromise: true
		}, aggressiveRetry);
		if (result.exceptionDetails) {
			const errMsg = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Eval error";
			throw new Error(errMsg);
		}
		return result.result?.value;
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
function clearFrameTargetsForTab(tabId) {
	for (const [key, targetId] of [...frameTargets.entries()]) {
		if (!key.startsWith(`${tabId}:`)) continue;
		frameTargets.delete(key);
		frameTargetKeys.delete(targetId);
		chrome.debugger.detach({ targetId }).catch(() => {});
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
	} catch {}
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
var connectInFlight = null;
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
	try {
		const msg = args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
		safeSend(ws, {
			type: "log",
			level,
			msg,
			ts: Date.now()
		});
	} catch {}
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
/**
* Probe the daemon via its /ping HTTP endpoint before attempting a WebSocket
* connection.  fetch() failures are silently catchable; new WebSocket() is not
* — Chrome logs ERR_CONNECTION_REFUSED to the extension error page before any
* JS handler can intercept it.  By keeping the probe inside connect() every
* call site remains unchanged and the guard can never be accidentally skipped.
*/
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
		if (!(await fetch(DAEMON_PING_URL, { signal: AbortSignal.timeout(1e3) })).ok) {
			scheduleReconnect();
			return;
		}
		notifyDaemonReachable();
	} catch {
		scheduleReconnect();
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
		reconnectPhaseStartedAt = 0;
		if (reconnectTimer) {
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
		reconnectTimerDelayMs = null;
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
			const result = await handleCommand(JSON.parse(event.data));
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
/**
* Reconnect cadence is phased and never gives up while Chrome keeps the
* service worker alive:
*
* - fast phase: every 3s for 30s after a disconnect/failure;
* - slow phase: every 15s after the fast window expires;
* - durable wake path: chrome.alarms. Production Chrome currently enforces a
*   30s minimum alarm interval, so alarms wake the service worker after idle
*   eviction while setTimeout provides the faster path only when the worker
*   remains alive.
*/
var RECONNECT_FAST_INTERVAL_MS = 3e3;
var RECONNECT_FAST_WINDOW_MS = 3e4;
var RECONNECT_SLOW_INTERVAL_MS = 15e3;
var reconnectPhaseStartedAt = 0;
var reconnectTimerDelayMs = null;
function nextReconnectDelayMs() {
	return Date.now() - reconnectPhaseStartedAt < RECONNECT_FAST_WINDOW_MS ? RECONNECT_FAST_INTERVAL_MS : RECONNECT_SLOW_INTERVAL_MS;
}
function scheduleReconnect(opts = {}) {
	if (reconnectTimer) {
		if (!opts.replaceExisting) return;
		clearTimeout(reconnectTimer);
		reconnectTimer = null;
		reconnectTimerDelayMs = null;
	}
	reconnectAttempts++;
	if (reconnectPhaseStartedAt === 0) reconnectPhaseStartedAt = Date.now();
	const delay = nextReconnectDelayMs();
	reconnectTimerDelayMs = delay;
	reconnectTimer = setTimeout(() => {
		reconnectTimer = null;
		reconnectTimerDelayMs = null;
		connect();
	}, delay);
}
function notifyDaemonReachable() {
	reconnectPhaseStartedAt = Date.now();
	if (reconnectTimer && reconnectTimerDelayMs !== RECONNECT_FAST_INTERVAL_MS) scheduleReconnect({ replaceExisting: true });
}
var automationSessions = /* @__PURE__ */ new Map();
var IDLE_TIMEOUT_DEFAULT = 3e4;
var IDLE_TIMEOUT_INTERACTIVE = 6e5;
var IDLE_TIMEOUT_NONE = -1;
var REGISTRY_KEY = "opencli_target_lease_registry_v2";
var LEASE_IDLE_ALARM_PREFIX = "opencli:lease-idle:";
var CONTAINER_TAB_GROUP_TITLE = {
	interactive: "OpenCLI Browser",
	automation: "OpenCLI Adapter"
};
var OWNED_TAB_GROUP_COLOR = "orange";
var leaseMutationQueue = Promise.resolve();
var ownedContainers = {
	interactive: {
		windowId: null,
		groupId: null,
		promise: null,
		groupPromise: null
	},
	automation: {
		windowId: null,
		groupId: null,
		promise: null,
		groupPromise: null
	}
};
var CommandFailure = class extends Error {
	constructor(code, message, hint) {
		super(message);
		this.code = code;
		this.hint = hint;
		this.name = "CommandFailure";
	}
};
/** Per-session custom timeout overrides set via command.idleTimeout */
var sessionTimeoutOverrides = /* @__PURE__ */ new Map();
var sessionWindowModeOverrides = /* @__PURE__ */ new Map();
var sessionLifecycleOverrides = /* @__PURE__ */ new Map();
var LEASE_KEY_SEPARATOR = "\0";
function getLeaseKey(session, surface) {
	return `${surface}${LEASE_KEY_SEPARATOR}${encodeURIComponent(session)}`;
}
function getSessionName(session) {
	const raw = session?.trim();
	if (!raw) throw new CommandFailure("session_required", "Browser session is required.", "Pass a browser session name, e.g. opencli browser <session> <command>.");
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
	if (getSurfaceFromKey(key) === "adapter" && (session?.lifecycle === "persistent" || sessionLifecycleOverrides.get(key) === "persistent")) return IDLE_TIMEOUT_NONE;
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
				groupId: null
			}
		},
		leases: {}
	};
}
async function readRegistry() {
	try {
		const local = chrome.storage?.local;
		if (!local) return emptyRegistry();
		const stored = (await local.get(REGISTRY_KEY))[REGISTRY_KEY];
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
					groupId: null
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
	} catch {}
}
async function persistRuntimeState() {
	const leases = {};
	for (const [leaseKey, session] of automationSessions.entries()) leases[leaseKey] = {
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
				groupId: null
			}
		},
		leases
	});
}
function scheduleIdleAlarm(leaseKey, timeout) {
	const alarmName = makeAlarmName(leaseKey);
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
		persistRuntimeState();
		return;
	}
	session.idleDeadlineAt = Date.now() + timeout;
	persistRuntimeState();
	session.idleTimer = setTimeout(async () => {
		await releaseLease(leaseKey, "idle timeout");
	}, timeout);
}
function getOwnedContainerGroupTitles(role) {
	return role === "automation" ? [] : [CONTAINER_TAB_GROUP_TITLE.interactive];
}
async function focusOwnedWindowIfRequested(windowId, mode) {
	if (mode !== "foreground") return;
	const updateWindow = chrome.windows.update;
	if (typeof updateWindow === "function") await updateWindow(windowId, { focused: true }).catch(() => {});
}
async function toOwnedContainerGroupCandidate(group) {
	try {
		const chromeWindow = await chrome.windows.get(group.windowId);
		const reusableTabId = await findReusableOwnedContainerTab(group.windowId, group.id);
		return {
			id: group.id,
			windowId: group.windowId,
			title: group.title,
			focused: !!chromeWindow.focused,
			hasReusableTab: reusableTabId !== void 0
		};
	} catch {
		return null;
	}
}
function selectOwnedContainerGroupCandidate(candidates) {
	if (candidates.length === 0) return null;
	return [...candidates].sort((a, b) => {
		if (a.focused !== b.focused) return a.focused ? -1 : 1;
		if (a.hasReusableTab !== b.hasReusableTab) return a.hasReusableTab ? -1 : 1;
		if (a.windowId !== b.windowId) return a.windowId - b.windowId;
		return a.id - b.id;
	})[0];
}
async function collectOwnedGroupCandidates(role) {
	if (role === "automation") return [];
	const container = ownedContainers[role];
	const groupsById = /* @__PURE__ */ new Map();
	if (container.groupId !== null) try {
		const group = await chrome.tabGroups.get(container.groupId);
		groupsById.set(group.id, group);
	} catch {
		container.groupId = null;
	}
	for (const title of getOwnedContainerGroupTitles(role)) {
		const groups = await chrome.tabGroups.query({ title });
		for (const group of groups) groupsById.set(group.id, group);
	}
	for (const [leaseKey, session] of automationSessions.entries()) {
		if (!session.owned || getOwnedWindowRole(leaseKey) !== role || session.preferredTabId === null) continue;
		try {
			const groupId = (await chrome.tabs.get(session.preferredTabId)).groupId;
			if (typeof groupId !== "number" || groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) continue;
			const group = await chrome.tabGroups.get(groupId);
			groupsById.set(group.id, group);
		} catch {}
	}
	const ownedPreferredTabIds = /* @__PURE__ */ new Set();
	for (const [leaseKey, session] of automationSessions.entries()) {
		if (!session.owned || getOwnedWindowRole(leaseKey) !== role || session.preferredTabId === null) continue;
		ownedPreferredTabIds.add(session.preferredTabId);
	}
	if (ownedPreferredTabIds.size > 0) try {
		const allGroups = await chrome.tabGroups.query({});
		for (const group of allGroups) {
			if (group.title) continue;
			if (groupsById.has(group.id)) continue;
			if ((await chrome.tabs.query({ groupId: group.id })).some((tab) => tab.id !== void 0 && ownedPreferredTabIds.has(tab.id))) groupsById.set(group.id, group);
		}
	} catch {}
	return (await Promise.all([...groupsById.values()].map(toOwnedContainerGroupCandidate))).filter((candidate) => candidate !== null);
}
function updateOwnedSessionWindowForTabs(role, tabIds, windowId) {
	const moved = new Set(tabIds);
	for (const [leaseKey, session] of automationSessions.entries()) {
		if (!session.owned || getOwnedWindowRole(leaseKey) !== role) continue;
		if (session.preferredTabId !== null && moved.has(session.preferredTabId)) session.windowId = windowId;
	}
}
async function ensureTabsInWindow(tabIds, windowId) {
	const movedIds = [];
	for (const tabId of tabIds) try {
		if ((await chrome.tabs.get(tabId)).windowId !== windowId) {
			await chrome.tabs.move(tabId, {
				windowId,
				index: -1
			});
			movedIds.push(tabId);
		}
	} catch {}
	return movedIds;
}
async function ensureCanonicalGroupTitle(role, group) {
	const canonicalTitle = CONTAINER_TAB_GROUP_TITLE[role];
	if (group.title === canonicalTitle) return group;
	const updated = await chrome.tabGroups.update(group.id, {
		title: canonicalTitle,
		color: OWNED_TAB_GROUP_COLOR
	});
	return {
		id: updated.id,
		windowId: updated.windowId,
		title: updated.title
	};
}
async function convergeOwnedGroupDuplicates(role, canonical, candidates) {
	for (const duplicate of candidates) {
		if (duplicate.id === canonical.id) continue;
		const tabIds = (await chrome.tabs.query({ groupId: duplicate.id })).map((tab) => tab.id).filter((id) => id !== void 0);
		if (tabIds.length === 0) continue;
		await ensureTabsInWindow(tabIds, canonical.windowId);
		await chrome.tabs.group({
			groupId: canonical.id,
			tabIds
		});
		updateOwnedSessionWindowForTabs(role, tabIds, canonical.windowId);
	}
	return canonical;
}
async function attachTabsToOwnedGroup(role, group, ids) {
	if (ids.length === 0) return group;
	await ensureTabsInWindow(ids, group.windowId);
	const missing = (await Promise.all(ids.map((id) => chrome.tabs.get(id).catch(() => null)))).filter((tab) => tab !== null && tab.id !== void 0 && tab.groupId !== group.id).map((tab) => tab.id);
	if (missing.length > 0) await chrome.tabs.group({
		groupId: group.id,
		tabIds: missing
	});
	updateOwnedSessionWindowForTabs(role, ids, group.windowId);
	return group;
}
async function createOwnedGroup(role, windowId, ids) {
	if (ids.length === 0) throw new Error(`Cannot create ${role} tab group without tabs`);
	await ensureTabsInWindow(ids, windowId);
	const groupId = await chrome.tabs.group({
		tabIds: ids,
		createProperties: { windowId }
	});
	ownedContainers[role].groupId = groupId;
	ownedContainers[role].windowId = windowId;
	await persistRuntimeState();
	const group = await chrome.tabGroups.update(groupId, {
		color: OWNED_TAB_GROUP_COLOR,
		title: CONTAINER_TAB_GROUP_TITLE[role],
		collapsed: false
	});
	updateOwnedSessionWindowForTabs(role, ids, group.windowId);
	return {
		id: group.id,
		windowId: group.windowId,
		title: group.title
	};
}
async function ensureOwnedContainerGroup(role, fallbackWindowId, tabIds) {
	if (role === "automation") return null;
	const ids = [...new Set(tabIds.filter((id) => id !== void 0))];
	const container = ownedContainers[role];
	const trackedGroupPromise = (container.groupPromise ?? Promise.resolve(null)).catch(() => null).then(() => ensureOwnedContainerGroupUnlocked(role, fallbackWindowId, ids)).finally(() => {
		if (container.groupPromise === trackedGroupPromise) container.groupPromise = null;
	});
	container.groupPromise = trackedGroupPromise;
	return trackedGroupPromise;
}
async function ensureOwnedContainerGroupUnlocked(role, fallbackWindowId, ids) {
	try {
		const candidates = await collectOwnedGroupCandidates(role);
		const selected = selectOwnedContainerGroupCandidate(candidates);
		let canonical = selected ? {
			id: selected.id,
			windowId: selected.windowId,
			title: selected.title
		} : null;
		if (canonical) {
			canonical = await convergeOwnedGroupDuplicates(role, canonical, candidates);
			canonical = await ensureCanonicalGroupTitle(role, canonical);
			canonical = await attachTabsToOwnedGroup(role, canonical, ids);
		} else if (fallbackWindowId !== null && ids.length > 0) canonical = await createOwnedGroup(role, fallbackWindowId, ids);
		if (canonical) {
			ownedContainers[role].windowId = canonical.windowId;
			ownedContainers[role].groupId = canonical.id;
		} else {
			ownedContainers[role].groupId = null;
			if (fallbackWindowId === null) ownedContainers[role].windowId = null;
		}
		return canonical;
	} catch (err) {
		console.warn(`[opencli] Failed to ensure ${role} tab group: ${err instanceof Error ? err.message : String(err)}`);
		throw err;
	}
}
/**
* Ensure the owned window for the requested role exists.
*
* First-principles model:
* - BrowserContext is the user's default Chrome profile.
* - Session identity maps to a TargetLease (usually a tab), not a window.
* - Browser commands and adapters use separate owned windows so foreground
*   interactive work cannot drag background adapter automation into view.
*/
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
	if (container.windowId !== null) try {
		await chrome.windows.get(container.windowId);
		const group = await ensureOwnedContainerGroup(role, container.windowId, []);
		if (group) {
			await focusOwnedWindowIfRequested(group.windowId, mode);
			const initialTabId = await findReusableOwnedContainerTab(group.windowId, group.id);
			return {
				windowId: group.windowId,
				initialTabId
			};
		}
		await focusOwnedWindowIfRequested(container.windowId, mode);
		const initialTabId = await findReusableOwnedContainerTab(container.windowId, null);
		const createdGroup = await ensureOwnedContainerGroup(role, container.windowId, [initialTabId]);
		if (createdGroup) return {
			windowId: createdGroup.windowId,
			initialTabId
		};
		return {
			windowId: container.windowId,
			initialTabId
		};
	} catch {
		container.windowId = null;
		container.groupId = null;
	}
	const existingGroup = await ensureOwnedContainerGroup(role, null, []);
	if (existingGroup) {
		await focusOwnedWindowIfRequested(existingGroup.windowId, mode);
		const initialTabId = await findReusableOwnedContainerTab(existingGroup.windowId, existingGroup.id);
		await persistRuntimeState();
		return {
			windowId: existingGroup.windowId,
			initialTabId
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
	await persistRuntimeState();
	console.log(`[opencli] Created owned ${role} window ${container.windowId} (start=${startUrl})`);
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
	const group = await ensureOwnedContainerGroup(role, container.windowId, [initialTabId]);
	await persistRuntimeState();
	return {
		windowId: group?.windowId ?? container.windowId,
		initialTabId
	};
}
async function findReusableOwnedContainerTab(windowId, ownedGroupId) {
	try {
		return (await chrome.tabs.query({ windowId })).find((tab) => tab.id !== void 0 && initialTabIsAvailable(tab.id) && isDebuggableUrl(tab.url) && (ownedGroupId === void 0 || ownedGroupId !== null && tab.groupId === ownedGroupId || !isSafeNavigationUrl(tab.url ?? "")))?.id;
	} catch {
		return;
	}
}
function initialTabIsAvailable(tabId) {
	if (tabId === void 0) return false;
	for (const session of automationSessions.values()) if (session.owned && session.preferredTabId === tabId) return false;
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
	} else tab = await chrome.tabs.create({
		windowId,
		url: targetUrl,
		active: true
	});
	const tabId = tab.id;
	if (!tabId) throw new Error("Failed to create tab lease in automation container");
	const sessionWindowId = (await ensureOwnedContainerGroup(role, windowId, [tabId]))?.windowId ?? tab.windowId;
	if (tab.windowId !== sessionWindowId) tab = await chrome.tabs.get(tabId);
	setLeaseSession(leaseKey, {
		session: getSessionFromKey(leaseKey),
		surface: getSurfaceFromKey(leaseKey),
		kind: "owned",
		windowId: sessionWindowId,
		owned: true,
		preferredTabId: tabId
	});
	resetWindowIdleTimer(leaseKey);
	return {
		tabId,
		tab
	};
}
/** Get or create the dedicated automation container window.
*  This compatibility helper returns the shared owned container. Leases
*  lease tabs inside it instead of owning separate windows.
*/
async function getAutomationWindow(leaseKey, initialUrl) {
	const existing = automationSessions.get(leaseKey);
	if (existing) {
		if (!existing.owned) throw new CommandFailure("bound_window_operation_blocked", `Session "${existing.session}" is bound to a user tab and does not own an OpenCLI tab lease.`, "Use page commands on the bound tab, or unbind the session first.");
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
	return (await ensureOwnedContainerWindow(getOwnedWindowRole(leaseKey), initialUrl, getWindowMode(leaseKey))).windowId;
}
chrome.windows.onRemoved.addListener(async (windowId) => {
	for (const container of Object.values(ownedContainers)) if (container.windowId === windowId) {
		container.windowId = null;
		container.groupId = null;
	}
	for (const [leaseKey, session] of automationSessions.entries()) if (session.windowId === windowId) {
		console.log(`[opencli] ${session.surface} container closed (session=${session.session})`);
		if (session.idleTimer) clearTimeout(session.idleTimer);
		automationSessions.delete(leaseKey);
		sessionTimeoutOverrides.delete(leaseKey);
		sessionWindowModeOverrides.delete(leaseKey);
		sessionLifecycleOverrides.delete(leaseKey);
		scheduleIdleAlarm(leaseKey, IDLE_TIMEOUT_NONE);
	}
	await persistRuntimeState();
});
chrome.tabs.onRemoved.addListener(async (tabId) => {
	evictTab(tabId);
	for (const [leaseKey, session] of automationSessions.entries()) if (session.preferredTabId === tabId) {
		if (session.idleTimer) clearTimeout(session.idleTimer);
		automationSessions.delete(leaseKey);
		sessionTimeoutOverrides.delete(leaseKey);
		sessionWindowModeOverrides.delete(leaseKey);
		sessionLifecycleOverrides.delete(leaseKey);
		scheduleIdleAlarm(leaseKey, IDLE_TIMEOUT_NONE);
		console.log(`[opencli] Session ${session.session} detached from tab ${tabId} (tab closed)`);
	}
	await persistRuntimeState();
});
var initialized = false;
function initialize() {
	if (initialized) return;
	initialized = true;
	chrome.alarms.create("keepalive", { periodInMinutes: .5 });
	registerListeners();
	try {
		registerFrameTracking?.();
	} catch {}
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
initialize();
chrome.alarms.onAlarm.addListener(async (alarm) => {
	if (alarm.name === "keepalive") connect();
	const leaseKey = leaseKeyFromAlarmName(alarm.name);
	if (leaseKey) await releaseLease(leaseKey, "idle alarm");
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
	const session = getSessionName(cmd.session);
	const surface = getCommandSurface(cmd);
	const leaseKey = getLeaseKey(session, surface);
	if (cmd.windowMode === "foreground" || cmd.windowMode === "background") sessionWindowModeOverrides.set(leaseKey, cmd.windowMode);
	if (surface === "adapter" && (cmd.siteSession === "persistent" || cmd.siteSession === "ephemeral")) sessionLifecycleOverrides.set(leaseKey, cmd.siteSession);
	if (cmd.idleTimeout != null && cmd.idleTimeout > 0) sessionTimeoutOverrides.set(leaseKey, cmd.idleTimeout * 1e3);
	resetWindowIdleTimer(leaseKey);
	try {
		switch (cmd.action) {
			case "exec": return await handleExec(cmd, leaseKey);
			case "navigate": return await handleNavigate(cmd, leaseKey);
			case "tabs": return await handleTabs(cmd, leaseKey);
			case "cookies": return await handleCookies(cmd);
			case "screenshot": return await handleScreenshot(cmd, leaseKey);
			case "close-window": return await handleCloseWindow(cmd, leaseKey);
			case "cdp": return await handleCdp(cmd, leaseKey);
			case "set-file-input": return await handleSetFileInput(cmd, leaseKey);
			case "insert-text": return await handleInsertText(cmd, leaseKey);
			case "bind": return await handleBind(cmd, leaseKey);
			case "network-capture-start": return await handleNetworkCaptureStart(cmd, leaseKey);
			case "network-capture-read": return await handleNetworkCaptureRead(cmd, leaseKey);
			case "wait-download": return await handleWaitDownload(cmd);
			case "frames": return await handleFrames(cmd, leaseKey);
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
* Resolve target tab for the session lease, returning both the tabId and
* the Tab object (when available) so callers can skip a redundant chrome.tabs.get().
*/
async function resolveTab(tabId, leaseKey, initialUrl) {
	const existingSession = automationSessions.get(leaseKey);
	if (tabId !== void 0) try {
		const tab = await chrome.tabs.get(tabId);
		const session = existingSession;
		const matchesSession = session ? session.preferredTabId !== null ? session.preferredTabId === tabId : tab.windowId === session.windowId : false;
		if (isDebuggableUrl(tab.url) && matchesSession) return {
			tabId,
			tab
		};
		if (session && !session.owned) throw new CommandFailure(matchesSession ? "bound_tab_not_debuggable" : "bound_tab_mismatch", matchesSession ? `Bound tab for session "${session.session}" is not debuggable (${tab.url ?? "unknown URL"}).` : `Target tab is not the tab bound to session "${session.session}".`, "Run \"opencli browser bind\" again on a debuggable http(s) tab.");
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
			automationSessions.delete(leaseKey);
			throw new CommandFailure("bound_tab_gone", `Bound tab for session "${existingSession.session}" no longer exists.`, "Run \"opencli browser bind\" again, then retry the command.");
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
			if (!session.owned) throw new CommandFailure("bound_tab_not_debuggable", `Bound tab for session "${session.session}" is not debuggable (${preferredTab.url ?? "unknown URL"}).`, "Switch the tab to an http(s) page or run \"opencli browser bind\" on another tab.");
		} catch (err) {
			if (err instanceof CommandFailure) throw err;
			await removeLeaseSession(leaseKey);
			if (!session.owned) throw new CommandFailure("bound_tab_gone", `Bound tab for session "${session.session}" no longer exists.`, "Run \"opencli browser bind\" again, then retry the command.");
			return createOwnedTabLease(leaseKey, initialUrl);
		}
	}
	if (!existingSession || existingSession.owned && existingSession.preferredTabId === null) return createOwnedTabLease(leaseKey, initialUrl);
	const windowId = await getAutomationWindow(leaseKey, initialUrl);
	const role = getOwnedWindowRole(leaseKey);
	const group = existingSession?.owned ? await ensureOwnedContainerGroup(role, windowId, []) : null;
	const scopedWindowId = group?.windowId ?? windowId;
	const reusableTabId = await findReusableOwnedContainerTab(scopedWindowId, existingSession?.owned ? group?.id ?? null : void 0);
	if (reusableTabId !== void 0) return {
		tabId: reusableTabId,
		tab: await chrome.tabs.get(reusableTabId)
	};
	const tabs = await chrome.tabs.query({ windowId: scopedWindowId });
	const reuseTab = existingSession?.owned ? void 0 : tabs.find((t) => t.id);
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
		windowId: scopedWindowId,
		url: BLANK_PAGE,
		active: true
	});
	if (!newTab.id) throw new Error("Failed to create tab in automation container");
	await ensureOwnedContainerGroup(role, scopedWindowId, [newTab.id]);
	return {
		tabId: newTab.id,
		tab: await chrome.tabs.get(newTab.id)
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
async function resolveTabId(tabId, leaseKey, initialUrl) {
	return (await resolveTab(tabId, leaseKey, initialUrl)).tabId;
}
async function listAutomationTabs(leaseKey) {
	const session = automationSessions.get(leaseKey);
	if (!session) return [];
	if (session.preferredTabId !== null) try {
		return [await chrome.tabs.get(session.preferredTabId)];
	} catch {
		automationSessions.delete(leaseKey);
		return [];
	}
	try {
		return await chrome.tabs.query({ windowId: session.windowId });
	} catch {
		automationSessions.delete(leaseKey);
		return [];
	}
}
async function listAutomationWebTabs(leaseKey) {
	return (await listAutomationTabs(leaseKey)).filter((tab) => isDebuggableUrl(tab.url));
}
async function handleExec(cmd, leaseKey) {
	if (!cmd.code) return {
		id: cmd.id,
		ok: false,
		error: "Missing code"
	};
	const tabId = await resolveTabId(await resolveCommandTabId(cmd), leaseKey);
	try {
		const aggressive = getSurfaceFromKey(leaseKey) === "browser";
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
async function handleFrames(cmd, leaseKey) {
	const tabId = await resolveTabId(await resolveCommandTabId(cmd), leaseKey);
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
async function handleNavigate(cmd, leaseKey) {
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
	const resolved = await resolveTab(await resolveCommandTabId(cmd), leaseKey, cmd.url);
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
	const postNavigationSession = automationSessions.get(leaseKey);
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
async function handleTabs(cmd, leaseKey) {
	const session = automationSessions.get(leaseKey);
	if (session && !session.owned && cmd.op !== "list") return {
		id: cmd.id,
		ok: false,
		errorCode: "bound_tab_mutation_blocked",
		error: `Session "${session.session}" is bound to a user tab; tab new/select/close requires an owned OpenCLI session.`,
		errorHint: "Unbind the session first, or use a different session for owned OpenCLI tabs."
	};
	switch (cmd.op) {
		case "list": {
			const tabs = await listAutomationWebTabs(leaseKey);
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
			if (!automationSessions.has(leaseKey)) {
				const created = await createOwnedTabLease(leaseKey, cmd.url);
				return pageScopedResult(cmd.id, created.tabId, { url: created.tab?.url });
			}
			const windowId = await getAutomationWindow(leaseKey);
			let tab = await chrome.tabs.create({
				windowId,
				url: cmd.url ?? BLANK_PAGE,
				active: true
			});
			const tabId = tab.id;
			if (!tabId) return {
				id: cmd.id,
				ok: false,
				error: "Failed to create tab"
			};
			const sessionWindowId = (await ensureOwnedContainerGroup(getOwnedWindowRole(leaseKey), windowId, [tabId]))?.windowId ?? tab.windowId;
			if (tab.windowId !== sessionWindowId) tab = await chrome.tabs.get(tabId);
			setLeaseSession(leaseKey, {
				session: getSessionFromKey(leaseKey),
				surface: getSurfaceFromKey(leaseKey),
				kind: "owned",
				windowId: sessionWindowId,
				owned: true,
				preferredTabId: tabId
			});
			resetWindowIdleTimer(leaseKey);
			return pageScopedResult(cmd.id, tabId, { url: tab.url });
		}
		case "close": {
			if (cmd.index !== void 0) {
				const target = (await listAutomationWebTabs(leaseKey))[cmd.index];
				if (!target?.id) return {
					id: cmd.id,
					ok: false,
					error: `Tab index ${cmd.index} not found`
				};
				const closedPage = await resolveTargetId(target.id).catch(() => void 0);
				if (automationSessions.get(leaseKey)?.preferredTabId === target.id) await releaseLease(leaseKey, "tab close");
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
			const tabId = await resolveTabId(await resolveCommandTabId(cmd), leaseKey);
			const closedPage = await resolveTargetId(tabId).catch(() => void 0);
			if (automationSessions.get(leaseKey)?.preferredTabId === tabId) await releaseLease(leaseKey, "tab close");
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
				const session = automationSessions.get(leaseKey);
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
			const target = (await listAutomationWebTabs(leaseKey))[cmd.index];
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
async function handleScreenshot(cmd, leaseKey) {
	const tabId = await resolveTabId(await resolveCommandTabId(cmd), leaseKey);
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
async function handleCdp(cmd, leaseKey) {
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
	const tabId = await resolveTabId(await resolveCommandTabId(cmd), leaseKey);
	try {
		const aggressive = getSurfaceFromKey(leaseKey) === "browser";
		await ensureAttached(tabId, aggressive);
		const params = cmd.cdpParams ?? {};
		const routeFrameId = typeof params.frameId === "string" && params.sessionId === "target" ? params.frameId : void 0;
		const routeTargetUrl = typeof params.targetUrl === "string" ? params.targetUrl : void 0;
		const data = routeFrameId ? await sendCommandInFrameTarget(tabId, routeFrameId, cmd.cdpMethod, stripOpenCliFrameRoutingParams(params, true), aggressive, 3e4, routeTargetUrl) : await chrome.debugger.sendCommand({ tabId }, cmd.cdpMethod, stripOpenCliFrameRoutingParams(params, false));
		return pageScopedResult(cmd.id, tabId, data);
	} catch (err) {
		return {
			id: cmd.id,
			ok: false,
			error: err instanceof Error ? err.message : String(err)
		};
	}
}
function stripOpenCliFrameRoutingParams(params, stripFrameId) {
	const { sessionId, frameId, targetUrl, ...rest } = params;
	if (!stripFrameId && frameId !== void 0) return {
		...rest,
		frameId
	};
	return rest;
}
async function handleCloseWindow(cmd, leaseKey) {
	const sessionName = automationSessions.get(leaseKey)?.session ?? getSessionFromKey(leaseKey);
	await releaseLease(leaseKey, "explicit close");
	return {
		id: cmd.id,
		ok: true,
		data: {
			closed: true,
			session: sessionName
		}
	};
}
async function handleSetFileInput(cmd, leaseKey) {
	if (!cmd.files || !Array.isArray(cmd.files) || cmd.files.length === 0) return {
		id: cmd.id,
		ok: false,
		error: "Missing or empty files array"
	};
	const tabId = await resolveTabId(await resolveCommandTabId(cmd), leaseKey);
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
async function handleInsertText(cmd, leaseKey) {
	if (typeof cmd.text !== "string") return {
		id: cmd.id,
		ok: false,
		error: "Missing text payload"
	};
	const tabId = await resolveTabId(await resolveCommandTabId(cmd), leaseKey);
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
async function handleNetworkCaptureStart(cmd, leaseKey) {
	const tabId = await resolveTabId(await resolveCommandTabId(cmd), leaseKey);
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
async function handleNetworkCaptureRead(cmd, leaseKey) {
	const tabId = await resolveTabId(await resolveCommandTabId(cmd), leaseKey);
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
async function handleWaitDownload(cmd) {
	try {
		const data = await waitForDownload(cmd.pattern ?? "", cmd.timeoutMs ?? 3e4);
		return {
			id: cmd.id,
			ok: true,
			data
		};
	} catch (err) {
		return {
			id: cmd.id,
			ok: false,
			error: err instanceof Error ? err.message : String(err)
		};
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
			const hasOtherOwnedLease = [...automationSessions.entries()].some(([otherLease, otherSession]) => otherLease !== leaseKey && otherSession.owned && otherSession.windowId === session.windowId && otherSession.preferredTabId !== null);
			await safeDetach(tabId);
			evictTab(tabId);
			if (hasOtherOwnedLease) {
				await chrome.tabs.remove(tabId).catch(() => {});
				console.log(`[opencli] Released owned tab lease ${tabId} (session=${session.session}, surface=${session.surface}, ${reason})`);
			} else try {
				const tab = await chrome.tabs.update(tabId, {
					url: BLANK_PAGE,
					active: true
				});
				const group = await ensureOwnedContainerGroup(getOwnedWindowRole(leaseKey), session.windowId, [tab.id ?? tabId]);
				if (group) session.windowId = group.windowId;
				console.log(`[opencli] Released owned tab lease ${tabId} as reusable placeholder (session=${session.session}, surface=${session.surface}, ${reason})`);
			} catch {
				await chrome.tabs.remove(tabId).catch(() => {});
				console.log(`[opencli] Released owned tab lease ${tabId} (session=${session.session}, surface=${session.surface}, ${reason})`);
			}
		} else console.log(`[opencli] Released legacy owned window lease ${session.windowId} without closing container (session=${session.session}, surface=${session.surface}, ${reason})`);
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
		if (windowId !== null) try {
			await chrome.windows.get(windowId);
		} catch {
			ownedContainers[role].windowId = null;
			ownedContainers[role].groupId = null;
		}
	}
	automationSessions.clear();
	for (const [leaseKey, stored] of Object.entries(registry.leases)) {
		const tabId = stored.preferredTabId;
		if (tabId === null) continue;
		try {
			const tab = await chrome.tabs.get(tabId);
			if (!isDebuggableUrl(tab.url)) continue;
			if (stored.lifecycle === "ephemeral" || stored.lifecycle === "persistent" || stored.lifecycle === "pinned") sessionLifecycleOverrides.set(leaseKey, stored.lifecycle);
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
				const group = await ensureOwnedContainerGroup(role, tab.windowId, [tabId]);
				if (group) {
					const current = automationSessions.get(leaseKey);
					if (current) current.windowId = group.windowId;
				}
			}
			const remaining = stored.idleDeadlineAt > 0 ? stored.idleDeadlineAt - Date.now() : timeout;
			if (timeout > 0) if (remaining <= 0) await releaseLease(leaseKey, "reconciled idle expiry");
			else resetWindowIdleTimer(leaseKey);
		} catch {}
	}
	await persistRuntimeState();
}
async function handleBind(cmd, leaseKey) {
	if (automationSessions.get(leaseKey)?.owned) await releaseLease(leaseKey, "rebind");
	const activeTabs = await chrome.tabs.query({
		active: true,
		lastFocusedWindow: true
	});
	const fallbackTabs = await chrome.tabs.query({ lastFocusedWindow: true });
	const boundTab = activeTabs.find((tab) => isDebuggableUrl(tab.url)) ?? fallbackTabs.find((tab) => isDebuggableUrl(tab.url));
	if (!boundTab?.id) return {
		id: cmd.id,
		ok: false,
		errorCode: "bound_tab_not_found",
		error: "No debuggable tab found in the current window",
		errorHint: "Focus the target Chrome tab/window, then retry bind."
	};
	const current = automationSessions.get(leaseKey);
	if (current && !current.owned && current.preferredTabId !== null && current.preferredTabId !== boundTab.id) await detach(current.preferredTabId).catch(() => {});
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
//#endregion
