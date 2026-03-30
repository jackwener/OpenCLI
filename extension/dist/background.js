//#region src/protocol.ts
/** Default daemon port */
var DAEMON_PORT = 19825;
var DAEMON_HOST = "localhost";
var DAEMON_WS_URL = `ws://${DAEMON_HOST}:${DAEMON_PORT}/ext`;
/** Lightweight health-check endpoint — probed before each WebSocket attempt. */
var DAEMON_PING_URL = `http://${DAEMON_HOST}:${DAEMON_PORT}/ping`;
/** Base reconnect delay for extension WebSocket (ms) */
var WS_RECONNECT_BASE_DELAY = 2e3;
/** Max reconnect delay (ms) */
var WS_RECONNECT_MAX_DELAY = 6e4;
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
/** Internal blank page used when no user URL is provided. */
var BLANK_PAGE$1 = "data:text/html,<html></html>";
/** Check if a URL can be attached via CDP — only allow http(s) and our internal blank page. */
function isDebuggableUrl$1(url) {
	if (!url) return true;
	return url.startsWith("http://") || url.startsWith("https://") || url === BLANK_PAGE$1;
}
async function ensureAttached(tabId) {
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
	try {
		await chrome.debugger.attach({ tabId }, "1.3");
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		const hint = msg.includes("chrome-extension://") ? ". Tip: another Chrome extension may be interfering — try disabling other extensions" : "";
		if (msg.includes("Another debugger is already attached")) {
			try {
				await chrome.debugger.detach({ tabId });
			} catch {}
			try {
				await chrome.debugger.attach({ tabId }, "1.3");
			} catch {
				throw new Error(`attach failed: ${msg}${hint}`);
			}
		} else throw new Error(`attach failed: ${msg}${hint}`);
	}
	attached.add(tabId);
	try {
		await chrome.debugger.sendCommand({ tabId }, "Runtime.enable");
	} catch {}
}
async function evaluate(tabId, expression) {
	await ensureAttached(tabId);
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
async function detach(tabId) {
	if (!attached.has(tabId)) return;
	attached.delete(tabId);
	try {
		await chrome.debugger.detach({ tabId });
	} catch {}
}
function registerListeners() {
	chrome.tabs.onRemoved.addListener((tabId) => {
		attached.delete(tabId);
	});
	chrome.debugger.onDetach.addListener((source) => {
		if (source.tabId) attached.delete(source.tabId);
	});
	chrome.tabs.onUpdated.addListener(async (tabId, info) => {
		if (info.url && !isDebuggableUrl$1(info.url)) await detach(tabId);
	});
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
			version: chrome.runtime.getManifest().version
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
var WINDOW_IDLE_TIMEOUT = 3e4;
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
		} catch {}
		automationSessions.delete(workspace);
	}, WINDOW_IDLE_TIMEOUT);
}
/** Get or create the dedicated automation window. */
async function getAutomationWindow(workspace) {
	const existing = automationSessions.get(workspace);
	if (existing) try {
		await chrome.windows.get(existing.windowId);
		return existing.windowId;
	} catch {
		automationSessions.delete(workspace);
	}
	const session = {
		windowId: (await chrome.windows.create({
			url: BLANK_PAGE,
			focused: false,
			width: 1280,
			height: 900,
			type: "normal"
		})).id,
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
	for (const [workspace, session] of automationSessions.entries()) if (session.windowId === windowId) {
		console.log(`[opencli] Automation window closed (${workspace})`);
		if (session.idleTimer) clearTimeout(session.idleTimer);
		automationSessions.delete(workspace);
	}
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
	resetWindowIdleTimer(workspace);
	try {
		switch (cmd.action) {
			case "exec": return await handleExec(cmd, workspace);
			case "navigate": return await handleNavigate(cmd, workspace);
			case "tabs": return await handleTabs(cmd, workspace);
			case "cookies": return await handleCookies(cmd);
			case "screenshot": return await handleScreenshot(cmd, workspace);
			case "close-window": return await handleCloseWindow(cmd, workspace);
			case "sessions": return await handleSessions(cmd);
			case "set-file-input": return await handleSetFileInput(cmd, workspace);
			case "bind-current": return await handleBindCurrent(cmd, workspace);
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
var BLANK_PAGE = "data:text/html,<html></html>";
/** Check if a URL can be attached via CDP — only allow http(s) and our internal blank page. */
function isDebuggableUrl(url) {
	if (!url) return true;
	return url.startsWith("http://") || url.startsWith("https://") || url === BLANK_PAGE;
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
/**
* Resolve target tab in the automation window.
* If explicit tabId is given, use that directly.
* Otherwise, find or create a tab in the dedicated automation window.
*/
async function resolveTabId(tabId, workspace) {
	if (tabId !== void 0) try {
		const tab = await chrome.tabs.get(tabId);
		const session = automationSessions.get(workspace);
		const matchesSession = session ? session.preferredTabId !== null ? session.preferredTabId === tabId : tab.windowId === session.windowId : false;
		if (isDebuggableUrl(tab.url) && matchesSession) return tabId;
		if (session && !matchesSession) console.warn(`[opencli] Tab ${tabId} is not bound to workspace ${workspace}, re-resolving`);
		else if (!isDebuggableUrl(tab.url)) console.warn(`[opencli] Tab ${tabId} URL is not debuggable (${tab.url}), re-resolving`);
	} catch {
		console.warn(`[opencli] Tab ${tabId} no longer exists, re-resolving`);
	}
	const adoptedTabId = await maybeBindWorkspaceToExistingTab(workspace);
	if (adoptedTabId !== null) return adoptedTabId;
	const existingSession = automationSessions.get(workspace);
	if (existingSession?.preferredTabId !== null) try {
		const preferredTab = await chrome.tabs.get(existingSession.preferredTabId);
		if (isDebuggableUrl(preferredTab.url)) return preferredTab.id;
	} catch {
		automationSessions.delete(workspace);
	}
	const windowId = await getAutomationWindow(workspace);
	const tabs = await chrome.tabs.query({ windowId });
	const debuggableTab = tabs.find((t) => t.id && isDebuggableUrl(t.url));
	if (debuggableTab?.id) return debuggableTab.id;
	const reuseTab = tabs.find((t) => t.id);
	if (reuseTab?.id) {
		await chrome.tabs.update(reuseTab.id, { url: BLANK_PAGE });
		await new Promise((resolve) => setTimeout(resolve, 300));
		try {
			const updated = await chrome.tabs.get(reuseTab.id);
			if (isDebuggableUrl(updated.url)) return reuseTab.id;
			console.warn(`[opencli] data: URI was intercepted (${updated.url}), creating fresh tab`);
		} catch {}
	}
	const newTab = await chrome.tabs.create({
		windowId,
		url: BLANK_PAGE,
		active: true
	});
	if (!newTab.id) throw new Error("Failed to create tab in automation window");
	return newTab.id;
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
	const tabId = await resolveTabId(cmd.tabId, workspace);
	try {
		const data = await evaluateAsync(tabId, cmd.code);
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
	const tabId = await resolveTabId(cmd.tabId, workspace);
	const beforeTab = await chrome.tabs.get(tabId);
	const beforeNormalized = normalizeUrlForComparison(beforeTab.url);
	const targetUrl = cmd.url;
	if (beforeTab.status === "complete" && isTargetUrl(beforeTab.url, targetUrl)) return {
		id: cmd.id,
		ok: true,
		data: {
			title: beforeTab.title,
			url: beforeTab.url,
			tabId,
			timedOut: false
		}
	};
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
	const tab = await chrome.tabs.get(tabId);
	return {
		id: cmd.id,
		ok: true,
		data: {
			title: tab.title,
			url: tab.url,
			tabId,
			timedOut
		}
	};
}
async function handleTabs(cmd, workspace) {
	switch (cmd.op) {
		case "list": {
			const data = (await listAutomationWebTabs(workspace)).map((t, i) => ({
				index: i,
				tabId: t.id,
				url: t.url,
				title: t.title,
				active: t.active
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
			return {
				id: cmd.id,
				ok: true,
				data: {
					tabId: tab.id,
					url: tab.url
				}
			};
		}
		case "close": {
			if (cmd.index !== void 0) {
				const target = (await listAutomationWebTabs(workspace))[cmd.index];
				if (!target?.id) return {
					id: cmd.id,
					ok: false,
					error: `Tab index ${cmd.index} not found`
				};
				await chrome.tabs.remove(target.id);
				await detach(target.id);
				return {
					id: cmd.id,
					ok: true,
					data: { closed: target.id }
				};
			}
			const tabId = await resolveTabId(cmd.tabId, workspace);
			await chrome.tabs.remove(tabId);
			await detach(tabId);
			return {
				id: cmd.id,
				ok: true,
				data: { closed: tabId }
			};
		}
		case "select": {
			if (cmd.index === void 0 && cmd.tabId === void 0) return {
				id: cmd.id,
				ok: false,
				error: "Missing index or tabId"
			};
			if (cmd.tabId !== void 0) {
				const session = automationSessions.get(workspace);
				let tab;
				try {
					tab = await chrome.tabs.get(cmd.tabId);
				} catch {
					return {
						id: cmd.id,
						ok: false,
						error: `Tab ${cmd.tabId} no longer exists`
					};
				}
				if (!session || tab.windowId !== session.windowId) return {
					id: cmd.id,
					ok: false,
					error: `Tab ${cmd.tabId} is not in the automation window`
				};
				await chrome.tabs.update(cmd.tabId, { active: true });
				return {
					id: cmd.id,
					ok: true,
					data: { selected: cmd.tabId }
				};
			}
			const target = (await listAutomationWebTabs(workspace))[cmd.index];
			if (!target?.id) return {
				id: cmd.id,
				ok: false,
				error: `Tab index ${cmd.index} not found`
			};
			await chrome.tabs.update(target.id, { active: true });
			return {
				id: cmd.id,
				ok: true,
				data: { selected: target.id }
			};
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
	const tabId = await resolveTabId(cmd.tabId, workspace);
	try {
		const data = await screenshot(tabId, {
			format: cmd.format,
			quality: cmd.quality,
			fullPage: cmd.fullPage
		});
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
async function handleCloseWindow(cmd, workspace) {
	const session = automationSessions.get(workspace);
	if (session) {
		if (session.owned) try {
			await chrome.windows.remove(session.windowId);
		} catch {}
		if (session.idleTimer) clearTimeout(session.idleTimer);
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
	const tabId = await resolveTabId(cmd.tabId, workspace);
	try {
		await setFileInputFiles(tabId, cmd.files, cmd.selector);
		return {
			id: cmd.id,
			ok: true,
			data: { count: cmd.files.length }
		};
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
//#endregion
