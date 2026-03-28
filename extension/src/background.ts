/**
 * OpenCLI — Service Worker (background script).
 *
 * Connects to the opencli daemon via WebSocket, receives commands,
 * dispatches them to Chrome APIs (debugger/tabs/cookies), returns results.
 *
 * WebSocket lives in an Offscreen document (offscreen.ts) so it is never
 * killed when the Service Worker is suspended by Chrome MV3.  The SW only
 * forwards messages to/from the offscreen document.
 */

import type { Command, Result } from './protocol';
import * as executor from './cdp';

// ─── Offscreen document management ──────────────────────────────────

const OFFSCREEN_URL = chrome.runtime.getURL('offscreen.html');

async function ensureOffscreen(): Promise<void> {
  // @ts-ignore — chrome.offscreen is typed in newer @types/chrome but may not
  // be present in older versions; we guard with existence check at runtime.
  if (!chrome.offscreen) return; // unsupported Chrome version, fall back silently
  const existing = await (chrome as any).offscreen.hasDocument();
  if (!existing) {
    await (chrome as any).offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['DOM_SCRAPING'],
      justification: 'Maintain persistent WebSocket connection to opencli daemon',
    });
  }
}

/** Tell the offscreen doc to (re-)connect. */
async function offscreenConnect(): Promise<void> {
  await ensureOffscreen();
  try {
    await chrome.runtime.sendMessage({ type: 'ws-connect' });
  } catch {
    // offscreen not ready yet — it will auto-connect on boot anyway
  }
}

/** Send a serialised result/hello string over the WebSocket. */
async function wsSend(payload: string): Promise<void> {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'ws-send', payload }) as { ok: boolean };
    if (!resp?.ok) {
      // Offscreen WS is down — trigger reconnect
      void offscreenConnect();
    }
  } catch {
    void offscreenConnect();
  }
}

/** Query live connection status from offscreen. */
async function wsStatus(): Promise<{ connected: boolean; reconnecting: boolean }> {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'ws-status' }) as any;
    return { connected: resp?.connected ?? false, reconnecting: resp?.reconnecting ?? false };
  } catch {
    return { connected: false, reconnecting: false };
  }
}

// ─── Console log forwarding ──────────────────────────────────────────
// Logs from offscreen arrive as { type:'log', level, msg, ts } messages.
// SW-side logs are forwarded directly via wsSend.

const _origLog = console.log.bind(console);
const _origWarn = console.warn.bind(console);
const _origError = console.error.bind(console);

function forwardLog(level: 'info' | 'warn' | 'error', args: unknown[]): void {
  const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  void wsSend(JSON.stringify({ type: 'log', level, msg, ts: Date.now() }));
}

console.log = (...args: unknown[]) => { _origLog(...args); forwardLog('info', args); };
console.warn = (...args: unknown[]) => { _origWarn(...args); forwardLog('warn', args); };
console.error = (...args: unknown[]) => { _origError(...args); forwardLog('error', args); };

// ─── Automation window isolation ─────────────────────────────────────

type AutomationSession = {
  windowId: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  idleDeadlineAt: number;
};

const automationSessions = new Map<string, AutomationSession>();
const WINDOW_IDLE_TIMEOUT = 30000;

function getWorkspaceKey(workspace?: string): string {
  return workspace?.trim() || 'default';
}

function resetWindowIdleTimer(workspace: string): void {
  const session = automationSessions.get(workspace);
  if (!session) return;
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleDeadlineAt = Date.now() + WINDOW_IDLE_TIMEOUT;
  session.idleTimer = setTimeout(async () => {
    const current = automationSessions.get(workspace);
    if (!current) return;
    try {
      await chrome.windows.remove(current.windowId);
      console.log(`[opencli] Automation window ${current.windowId} (${workspace}) closed (idle timeout)`);
    } catch { /* Already gone */ }
    automationSessions.delete(workspace);
  }, WINDOW_IDLE_TIMEOUT);
}

async function getAutomationWindow(workspace: string): Promise<number> {
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
    type: 'normal',
  });
  const session: AutomationSession = {
    windowId: win.id!,
    idleTimer: null,
    idleDeadlineAt: Date.now() + WINDOW_IDLE_TIMEOUT,
  };
  automationSessions.set(workspace, session);
  console.log(`[opencli] Created automation window ${session.windowId} (${workspace})`);
  resetWindowIdleTimer(workspace);
  await new Promise(resolve => setTimeout(resolve, 200));
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

// ─── Lifecycle events ────────────────────────────────────────────────

let initialized = false;

function initialize(): void {
  if (initialized) return;
  initialized = true;
  chrome.alarms.create('keepalive', { periodInMinutes: 0.25 }); // ~15 seconds — faster recovery after SW suspend
  executor.registerListeners();
  void offscreenConnect();
  console.log('[opencli] OpenCLI extension initialized');
}

chrome.runtime.onInstalled.addListener(() => {
  initialize();
});

chrome.runtime.onStartup.addListener(() => {
  initialize();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepalive') {
    // Ensure offscreen doc is alive and WS is connected after any SW suspend/resume.
    void offscreenConnect();
  }
});

// ─── Message router ──────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // ── Popup status query ──
  if (msg?.type === 'getStatus') {
    wsStatus().then(s => sendResponse(s));
    return true; // async
  }

  // ── Incoming WS frame from offscreen ──
  if (msg?.type === 'ws-message') {
    void (async () => {
      try {
        const command = JSON.parse(msg.data as string) as Command;
        const result = await handleCommand(command);
        await wsSend(JSON.stringify(result));
      } catch (err) {
        console.error('[opencli] Message handling error:', err);
      }
    })();
    return false;
  }

  // ── WS connected — send hello with real extension version ──
  if (msg?.type === 'ws-connected') {
    void wsSend(JSON.stringify({ type: 'hello', version: chrome.runtime.getManifest().version }));
    return false;
  }

  // ── Log forwarding from offscreen (pass through to WS) ──
  if (msg?.type === 'log') {
    void wsSend(JSON.stringify(msg));
    return false;
  }

  return false;
});

// ─── Command dispatcher ──────────────────────────────────────────────

async function handleCommand(cmd: Command): Promise<Result> {
  const workspace = getWorkspaceKey(cmd.workspace);
  resetWindowIdleTimer(workspace);
  try {
    switch (cmd.action) {
      case 'exec':
        return await handleExec(cmd, workspace);
      case 'navigate':
        return await handleNavigate(cmd, workspace);
      case 'tabs':
        return await handleTabs(cmd, workspace);
      case 'cookies':
        return await handleCookies(cmd);
      case 'screenshot':
        return await handleScreenshot(cmd, workspace);
      case 'close-window':
        return await handleCloseWindow(cmd, workspace);
      case 'cdp':
        return await handleCdp(cmd, workspace);
      case 'sessions':
        return await handleSessions(cmd);
      case 'set-file-input':
        return await handleSetFileInput(cmd, workspace);
      default:
        return { id: cmd.id, ok: false, error: `Unknown action: ${cmd.action}` };
    }
  } catch (err) {
    return {
      id: cmd.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Action handlers ─────────────────────────────────────────────────

/** Internal blank page used when no user URL is provided. */
const BLANK_PAGE = 'about:blank';

/** Check if a URL can be attached via CDP — only allow http(s) and blank pages. */
function isDebuggableUrl(url?: string): boolean {
  if (!url) return true;  // empty/undefined = tab still loading, allow it
  return url.startsWith('http://') || url.startsWith('https://') || url === 'about:blank' || url.startsWith('data:');
}

function isSafeNavigationUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

function normalizeUrlForComparison(url?: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    if ((parsed.protocol === 'https:' && parsed.port === '443') || (parsed.protocol === 'http:' && parsed.port === '80')) {
      parsed.port = '';
    }
    const pathname = parsed.pathname === '/' ? '' : parsed.pathname;
    return `${parsed.protocol}//${parsed.host}${pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

function isTargetUrl(currentUrl: string | undefined, targetUrl: string): boolean {
  return normalizeUrlForComparison(currentUrl) === normalizeUrlForComparison(targetUrl);
}

function setWorkspaceSession(workspace: string, session: Pick<AutomationSession, 'windowId'>): void {
  const existing = automationSessions.get(workspace);
  if (existing?.idleTimer) clearTimeout(existing.idleTimer);
  automationSessions.set(workspace, {
    ...session,
    idleTimer: null,
    idleDeadlineAt: Date.now() + WINDOW_IDLE_TIMEOUT,
  });
}

/**
 * Resolve target tab in the automation window.
 * If explicit tabId is given, use that directly.
 * Otherwise, find or create a tab in the dedicated automation window.
 */
async function resolveTabId(tabId: number | undefined, workspace: string): Promise<number> {
  if (tabId !== undefined) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const session = automationSessions.get(workspace);
      const matchesSession = session ? tab.windowId === session.windowId : false;
      if (isDebuggableUrl(tab.url) && matchesSession) return tabId;
      if (session && !matchesSession) {
        console.warn(`[opencli] Tab ${tabId} is not bound to workspace ${workspace}, re-resolving`);
      } else if (!isDebuggableUrl(tab.url)) {
        console.warn(`[opencli] Tab ${tabId} URL is not debuggable (${tab.url}), re-resolving`);
      }
    } catch {
      console.warn(`[opencli] Tab ${tabId} no longer exists, re-resolving`);
    }
  }

  const windowId = await getAutomationWindow(workspace);
  const tabs = await chrome.tabs.query({ windowId });
  const debuggableTab = tabs.find(t => t.id && isDebuggableUrl(t.url));
  if (debuggableTab?.id) return debuggableTab.id;

  const reuseTab = tabs.find(t => t.id);
  if (reuseTab?.id) {
    await chrome.tabs.update(reuseTab.id, { url: BLANK_PAGE });
    await new Promise(resolve => setTimeout(resolve, 300));
    try {
      const updated = await chrome.tabs.get(reuseTab.id);
      if (isDebuggableUrl(updated.url)) return reuseTab.id;
      console.warn(`[opencli] data: URI was intercepted (${updated.url}), creating fresh tab`);
    } catch { /* Tab was closed */ }
  }

  const newTab = await chrome.tabs.create({ windowId, url: BLANK_PAGE, active: true });
  if (!newTab.id) throw new Error('Failed to create tab in automation window');
  return newTab.id;
}

async function listAutomationTabs(workspace: string): Promise<chrome.tabs.Tab[]> {
  const session = automationSessions.get(workspace);
  if (!session) return [];
  try {
    return await chrome.tabs.query({ windowId: session.windowId });
  } catch {
    automationSessions.delete(workspace);
    return [];
  }
}

async function listAutomationWebTabs(workspace: string): Promise<chrome.tabs.Tab[]> {
  const tabs = await listAutomationTabs(workspace);
  return tabs.filter((tab) => isDebuggableUrl(tab.url));
}

async function handleExec(cmd: Command, workspace: string): Promise<Result> {
  if (!cmd.code) return { id: cmd.id, ok: false, error: 'Missing code' };
  const tabId = await resolveTabId(cmd.tabId, workspace);
  try {
    const aggressive = workspace.startsWith('operate:');
    const data = await executor.evaluateAsync(tabId, cmd.code, aggressive);
    return { id: cmd.id, ok: true, data };
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleNavigate(cmd: Command, workspace: string): Promise<Result> {
  if (!cmd.url) return { id: cmd.id, ok: false, error: 'Missing url' };
  if (!isSafeNavigationUrl(cmd.url)) {
    return { id: cmd.id, ok: false, error: 'Blocked URL scheme -- only http:// and https:// are allowed' };
  }
  const tabId = await resolveTabId(cmd.tabId, workspace);

  const beforeTab = await chrome.tabs.get(tabId);
  const beforeNormalized = normalizeUrlForComparison(beforeTab.url);
  const targetUrl = cmd.url;

  if (beforeTab.status === 'complete' && isTargetUrl(beforeTab.url, targetUrl)) {
    return {
      id: cmd.id,
      ok: true,
      data: { title: beforeTab.title, url: beforeTab.url, tabId, timedOut: false },
    };
  }

  await executor.detach(tabId);
  await chrome.tabs.update(tabId, { url: targetUrl });

  let timedOut = false;
  await new Promise<void>((resolve) => {
    let settled = false;
    let checkTimer: ReturnType<typeof setTimeout> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      chrome.tabs.onUpdated.removeListener(listener);
      if (checkTimer) clearTimeout(checkTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      resolve();
    };

    const isNavigationDone = (url: string | undefined): boolean => {
      return isTargetUrl(url, targetUrl) || normalizeUrlForComparison(url) !== beforeNormalized;
    };

    const listener = (id: number, info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (id !== tabId) return;
      if (info.status === 'complete' && isNavigationDone(tab.url ?? info.url)) finish();
    };
    chrome.tabs.onUpdated.addListener(listener);

    checkTimer = setTimeout(async () => {
      try {
        const currentTab = await chrome.tabs.get(tabId);
        if (currentTab.status === 'complete' && isNavigationDone(currentTab.url)) finish();
      } catch { /* tab gone */ }
    }, 100);

    timeoutTimer = setTimeout(() => {
      timedOut = true;
      console.warn(`[opencli] Navigate to ${targetUrl} timed out after 15s`);
      finish();
    }, 15000);
  });

  const tab = await chrome.tabs.get(tabId);
  return {
    id: cmd.id,
    ok: true,
    data: { title: tab.title, url: tab.url, tabId, timedOut },
  };
}

async function handleTabs(cmd: Command, workspace: string): Promise<Result> {
  switch (cmd.op) {
    case 'list': {
      const tabs = await listAutomationWebTabs(workspace);
      const data = tabs.map((t, i) => ({
        index: i,
        tabId: t.id,
        url: t.url,
        title: t.title,
        active: t.active,
      }));
      return { id: cmd.id, ok: true, data };
    }
    case 'new': {
      if (cmd.url && !isSafeNavigationUrl(cmd.url)) {
        return { id: cmd.id, ok: false, error: 'Blocked URL scheme -- only http:// and https:// are allowed' };
      }
      const windowId = await getAutomationWindow(workspace);
      const tab = await chrome.tabs.create({ windowId, url: cmd.url ?? BLANK_PAGE, active: true });
      return { id: cmd.id, ok: true, data: { tabId: tab.id, url: tab.url } };
    }
    case 'close': {
      if (cmd.index !== undefined) {
        const tabs = await listAutomationWebTabs(workspace);
        const target = tabs[cmd.index];
        if (!target?.id) return { id: cmd.id, ok: false, error: `Tab index ${cmd.index} not found` };
        await chrome.tabs.remove(target.id);
        await executor.detach(target.id);
        return { id: cmd.id, ok: true, data: { closed: target.id } };
      }
      const tabId = await resolveTabId(cmd.tabId, workspace);
      await chrome.tabs.remove(tabId);
      await executor.detach(tabId);
      return { id: cmd.id, ok: true, data: { closed: tabId } };
    }
    case 'select': {
      if (cmd.index === undefined && cmd.tabId === undefined)
        return { id: cmd.id, ok: false, error: 'Missing index or tabId' };
      if (cmd.tabId !== undefined) {
        const session = automationSessions.get(workspace);
        let tab: chrome.tabs.Tab;
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
      const target = tabs[cmd.index!];
      if (!target?.id) return { id: cmd.id, ok: false, error: `Tab index ${cmd.index} not found` };
      await chrome.tabs.update(target.id, { active: true });
      return { id: cmd.id, ok: true, data: { selected: target.id } };
    }
    default:
      return { id: cmd.id, ok: false, error: `Unknown tabs op: ${cmd.op}` };
  }
}

async function handleCookies(cmd: Command): Promise<Result> {
  if (!cmd.domain && !cmd.url) {
    return { id: cmd.id, ok: false, error: 'Cookie scope required: provide domain or url to avoid dumping all cookies' };
  }
  const details: chrome.cookies.GetAllDetails = {};
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
    expirationDate: c.expirationDate,
  }));
  return { id: cmd.id, ok: true, data };
}

async function handleScreenshot(cmd: Command, workspace: string): Promise<Result> {
  const tabId = await resolveTabId(cmd.tabId, workspace);
  try {
    const data = await executor.screenshot(tabId, {
      format: cmd.format,
      quality: cmd.quality,
      fullPage: cmd.fullPage,
    });
    return { id: cmd.id, ok: true, data };
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** CDP methods permitted via the 'cdp' passthrough action. */
const CDP_ALLOWLIST = new Set([
  // Agent DOM context
  'Accessibility.getFullAXTree',
  'DOM.getDocument',
  'DOM.getBoxModel',
  'DOM.getContentQuads',
  'DOM.querySelectorAll',
  'DOM.scrollIntoViewIfNeeded',
  'DOMSnapshot.captureSnapshot',
  // Native input events
  'Input.dispatchMouseEvent',
  'Input.dispatchKeyEvent',
  'Input.insertText',
  // Page metrics & screenshots
  'Page.getLayoutMetrics',
  'Page.captureScreenshot',
  // Runtime.enable needed for CDP attach setup (Runtime.evaluate goes through 'exec' action)
  'Runtime.enable',
  // Emulation (used by screenshot full-page)
  'Emulation.setDeviceMetricsOverride',
  'Emulation.clearDeviceMetricsOverride',
]);

async function handleCdp(cmd: Command, workspace: string): Promise<Result> {
  if (!cmd.cdpMethod) return { id: cmd.id, ok: false, error: 'Missing cdpMethod' };
  if (!CDP_ALLOWLIST.has(cmd.cdpMethod)) {
    return { id: cmd.id, ok: false, error: `CDP method not permitted: ${cmd.cdpMethod}` };
  }
  const tabId = await resolveTabId(cmd.tabId, workspace);
  try {
    const aggressive = workspace.startsWith('operate:');
    await executor.ensureAttached(tabId, aggressive);
    const data = await chrome.debugger.sendCommand(
      { tabId },
      cmd.cdpMethod,
      cmd.cdpParams ?? {},
    );
    return { id: cmd.id, ok: true, data };
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleCloseWindow(cmd: Command, workspace: string): Promise<Result> {
  const session = automationSessions.get(workspace);
  if (session) {
    try { await chrome.windows.remove(session.windowId); } catch { /* already closed */ }
    if (session.idleTimer) clearTimeout(session.idleTimer);
    automationSessions.delete(workspace);
  }
  return { id: cmd.id, ok: true, data: { closed: true } };
}

async function handleSetFileInput(cmd: Command, workspace: string): Promise<Result> {
  if (!cmd.files || !Array.isArray(cmd.files) || cmd.files.length === 0) {
    return { id: cmd.id, ok: false, error: 'Missing or empty files array' };
  }
  const tabId = await resolveTabId(cmd.tabId, workspace);
  try {
    await executor.setFileInputFiles(tabId, cmd.files, cmd.selector);
    return { id: cmd.id, ok: true, data: { count: cmd.files.length } };
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleSessions(cmd: Command): Promise<Result> {
  const now = Date.now();
  const data = await Promise.all([...automationSessions.entries()].map(async ([workspace, session]) => ({
    workspace,
    windowId: session.windowId,
    tabCount: (await chrome.tabs.query({ windowId: session.windowId })).filter((tab) => isDebuggableUrl(tab.url)).length,
    idleMsRemaining: Math.max(0, session.idleDeadlineAt - now),
  })));
  return { id: cmd.id, ok: true, data };
}

export const __test__ = {
  handleNavigate,
  isTargetUrl,
  handleTabs,
  handleSessions,
  resolveTabId,
  resetWindowIdleTimer,
  getSession: (workspace: string = 'default') => automationSessions.get(workspace) ?? null,
  getAutomationWindowId: (workspace: string = 'default') => automationSessions.get(workspace)?.windowId ?? null,
  setAutomationWindowId: (workspace: string, windowId: number | null) => {
    if (windowId === null) {
      const session = automationSessions.get(workspace);
      if (session?.idleTimer) clearTimeout(session.idleTimer);
      automationSessions.delete(workspace);
      return;
    }
    setWorkspaceSession(workspace, {
      windowId,
    });
  },
  setSession: (workspace: string, session: { windowId: number }) => {
    setWorkspaceSession(workspace, session);
  },
};
