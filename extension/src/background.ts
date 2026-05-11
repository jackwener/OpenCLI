/**
 * OpenCLI — Service Worker (background script).
 *
 * Connects to the opencli daemon via WebSocket, receives commands,
 * dispatches them to Chrome APIs (debugger/tabs/cookies), returns results.
 */

declare const __OPENCLI_COMPAT_RANGE__: string;

import type { Command, Result } from './protocol';
import { DAEMON_HOST, DAEMON_PORT, DAEMON_WS_URL, DAEMON_PING_URL, WS_RECONNECT_BASE_DELAY, WS_RECONNECT_MAX_DELAY } from './protocol';
import * as executor from './cdp';
import * as identity from './identity';

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const CONTEXT_ID_KEY = 'opencli_context_id_v1';
let currentContextId = 'default';
let contextIdPromise: Promise<string> | null = null;

async function getCurrentContextId(): Promise<string> {
  if (contextIdPromise) return contextIdPromise;
  contextIdPromise = (async () => {
    try {
      const local = chrome.storage?.local;
      if (!local) return currentContextId;
      const raw = await local.get(CONTEXT_ID_KEY) as Record<string, unknown>;
      const existing = raw[CONTEXT_ID_KEY];
      if (typeof existing === 'string' && existing.trim()) {
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

function generateContextId(): string {
  const alphabet = '23456789abcdefghjkmnpqrstuvwxyz';
  const maxUnbiasedByte = Math.floor(256 / alphabet.length) * alphabet.length;
  let id = '';
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

// ─── Console log forwarding ──────────────────────────────────────────
// Hook console.log/warn/error to forward logs to daemon via WebSocket.

const _origLog = console.log.bind(console);
const _origWarn = console.warn.bind(console);
const _origError = console.error.bind(console);

function forwardLog(level: 'info' | 'warn' | 'error', args: unknown[]): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    ws.send(JSON.stringify({ type: 'log', level, msg, ts: Date.now() }));
  } catch { /* don't recurse */ }
}

console.log = (...args: unknown[]) => { _origLog(...args); forwardLog('info', args); };
console.warn = (...args: unknown[]) => { _origWarn(...args); forwardLog('warn', args); };
console.error = (...args: unknown[]) => { _origError(...args); forwardLog('error', args); };

// ─── WebSocket connection ────────────────────────────────────────────

/**
 * Probe the daemon via its /ping HTTP endpoint before attempting a WebSocket
 * connection.  fetch() failures are silently catchable; new WebSocket() is not
 * — Chrome logs ERR_CONNECTION_REFUSED to the extension error page before any
 * JS handler can intercept it.  By keeping the probe inside connect() every
 * call site remains unchanged and the guard can never be accidentally skipped.
 */
async function connect(): Promise<void> {
  if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;

  try {
    const res = await fetch(DAEMON_PING_URL, { signal: AbortSignal.timeout(1000) });
    if (!res.ok) return; // unexpected response — not our daemon
  } catch {
    return; // daemon not running — skip WebSocket to avoid console noise
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
    console.log('[opencli] Connected to daemon');
    reconnectAttempts = 0; // Reset on successful connection
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    // Send version + compatibility range so the daemon can report mismatches to the CLI
    ws?.send(JSON.stringify({
      type: 'hello',
      contextId: currentContextId,
      version: chrome.runtime.getManifest().version,
      compatRange: __OPENCLI_COMPAT_RANGE__,
    }));
  };

  ws.onmessage = async (event) => {
    try {
      const command = JSON.parse(event.data as string) as Command;
      const result = await handleCommand(command);
      ws?.send(JSON.stringify(result));
    } catch (err) {
      console.error('[opencli] Message handling error:', err);
    }
  };

  ws.onclose = () => {
    console.log('[opencli] Disconnected from daemon');
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
const MAX_EAGER_ATTEMPTS = 6; // 2s, 4s, 8s, 16s, 32s, 60s — then stop

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectAttempts++;
  if (reconnectAttempts > MAX_EAGER_ATTEMPTS) return; // let keepalive alarm handle it
  const delay = Math.min(WS_RECONNECT_BASE_DELAY * Math.pow(2, reconnectAttempts - 1), WS_RECONNECT_MAX_DELAY);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect();
  }, delay);
}

// ─── Browser target leases ───────────────────────────────────────────
// A browser session owns or borrows a tab lease. Owned leases live in either
// the interactive browser window or the background adapter window; bound leases
// point at user-owned tabs. Lease behavior is stored as metadata instead of
// encoded in session-name prefixes.

type BrowserContextId = string;
type LeaseOwnership = 'owned' | 'borrowed';
type LeaseLifecycle = 'ephemeral' | 'persistent' | 'pinned';
type WindowRole = 'interactive' | 'automation' | 'borrowed-user';
type OwnedWindowRole = Exclude<WindowRole, 'borrowed-user'>;
type WindowMode = 'foreground' | 'background';
type BrowserSurface = 'browser' | 'adapter';
type LeaseKind = 'owned' | 'bound';

type TargetLease = {
  session: string;
  surface: BrowserSurface;
  kind: LeaseKind;
  windowId: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  idleDeadlineAt: number;
  owned: boolean;
  preferredTabId: number | null;
  contextId: BrowserContextId;
  ownership: LeaseOwnership;
  lifecycle: LeaseLifecycle;
  windowRole: WindowRole;
};

const automationSessions = new Map<string, TargetLease>();
const IDLE_TIMEOUT_DEFAULT = 30_000;      // 30s — adapter-driven automation
const IDLE_TIMEOUT_INTERACTIVE = 600_000; // 10min — human-paced browser:* / operate:*
const IDLE_TIMEOUT_NONE = -1;             // borrowed bound tabs stay bound until unbound/closed
const REGISTRY_KEY = 'opencli_target_lease_registry_v2';
const LEASE_IDLE_ALARM_PREFIX = 'opencli:lease-idle:';
const CONTAINER_TAB_GROUP_TITLE: Record<OwnedWindowRole, string> = {
  interactive: 'OpenCLI Browser',
  automation: 'OpenCLI Adapter',
};
const AUTOMATION_TAB_GROUP_COLOR: chrome.tabGroups.ColorEnum = 'orange';
let leaseMutationQueue: Promise<void> = Promise.resolve();
const ownedContainers: Record<OwnedWindowRole, {
  windowId: number | null;
  groupId: number | null;
  promise: Promise<{ windowId: number; initialTabId?: number }> | null;
}> = {
  interactive: { windowId: null, groupId: null, promise: null },
  automation: { windowId: null, groupId: null, promise: null },
};

type StoredLease = Omit<TargetLease, 'idleTimer' | 'idleDeadlineAt'> & {
  idleDeadlineAt: number;
  updatedAt: number;
};

type StoredRegistry = {
  version: 2;
  contextId: BrowserContextId;
  ownedContainers: Record<OwnedWindowRole, { windowId: number | null; groupId?: number | null }>;
  leases: Record<string, StoredLease>;
};

class CommandFailure extends Error {
  constructor(readonly code: string, message: string, readonly hint?: string) {
    super(message);
    this.name = 'CommandFailure';
  }
}

/** Per-session custom timeout overrides set via command.idleTimeout */
const sessionTimeoutOverrides = new Map<string, number>();
const sessionWindowModeOverrides = new Map<string, WindowMode>();
const sessionLifecycleOverrides = new Map<string, LeaseLifecycle>();
const LEASE_KEY_SEPARATOR = '\u0000';

function getLeaseKey(session: string, surface: BrowserSurface): string {
  return `${surface}${LEASE_KEY_SEPARATOR}${encodeURIComponent(session)}`;
}

function getSessionName(session?: string): string {
  const raw = session?.trim();
  if (!raw) throw new CommandFailure(
    'session_required',
    'Browser session is required.',
    'Pass --session <name> with opencli browser commands.',
  );
  return raw.includes(LEASE_KEY_SEPARATOR) ? getSessionFromKey(raw) : raw;
}

function getCommandSurface(cmd: Pick<Command, 'surface' | 'session'>): BrowserSurface {
  if (typeof cmd.session === 'string' && cmd.session.includes(LEASE_KEY_SEPARATOR)) {
    return getSurfaceFromKey(cmd.session);
  }
  return cmd.surface === 'adapter' ? 'adapter' : 'browser';
}

function getSurfaceFromKey(key: string): BrowserSurface {
  return key.split(LEASE_KEY_SEPARATOR, 1)[0] === 'adapter' ? 'adapter' : 'browser';
}

function getSessionFromKey(key: string): string {
  const idx = key.indexOf(LEASE_KEY_SEPARATOR);
  if (idx === -1) return key;
  try {
    return decodeURIComponent(key.slice(idx + 1));
  } catch {
    return key.slice(idx + 1);
  }
}

function getIdleTimeout(key: string): number {
  const session = automationSessions.get(key);
  if (session?.kind === 'bound') return IDLE_TIMEOUT_NONE;
  const adapterPersistent = getSurfaceFromKey(key) === 'adapter'
    && (session?.lifecycle === 'persistent' || sessionLifecycleOverrides.get(key) === 'persistent');
  if (adapterPersistent) return IDLE_TIMEOUT_NONE;
  const override = sessionTimeoutOverrides.get(key);
  if (override !== undefined) return override;
  return getSurfaceFromKey(key) === 'browser' ? IDLE_TIMEOUT_INTERACTIVE : IDLE_TIMEOUT_DEFAULT;
}

function getLeaseLifecycle(key: string, kind: LeaseKind): LeaseLifecycle {
  if (kind === 'bound') return 'pinned';
  const override = sessionLifecycleOverrides.get(key);
  if (override) return override;
  return getSurfaceFromKey(key) === 'browser' ? 'persistent' : 'ephemeral';
}

function getOwnedWindowRole(key: string): OwnedWindowRole {
  return getSurfaceFromKey(key) === 'browser' ? 'interactive' : 'automation';
}

function getWindowRole(key: string, ownership: LeaseOwnership): WindowRole {
  return ownership === 'borrowed' ? 'borrowed-user' : getOwnedWindowRole(key);
}

function getWindowMode(key: string): WindowMode {
  return sessionWindowModeOverrides.get(key)
    ?? (getOwnedWindowRole(key) === 'interactive' ? 'foreground' : 'background');
}

function makeAlarmName(leaseKey: string): string {
  return `${LEASE_IDLE_ALARM_PREFIX}${encodeURIComponent(leaseKey)}`;
}

function leaseKeyFromAlarmName(name: string): string | null {
  if (!name.startsWith(LEASE_IDLE_ALARM_PREFIX)) return null;
  try {
    return decodeURIComponent(name.slice(LEASE_IDLE_ALARM_PREFIX.length));
  } catch {
    return null;
  }
}

function withLeaseMutation<T>(fn: () => Promise<T>): Promise<T> {
  const run = leaseMutationQueue.then(fn, fn);
  leaseMutationQueue = run.then(() => undefined, () => undefined);
  return run;
}

function makeSession(
  key: string,
  session: Omit<TargetLease, 'idleTimer' | 'idleDeadlineAt' | 'contextId' | 'ownership' | 'lifecycle' | 'windowRole'>,
): Omit<TargetLease, 'idleTimer' | 'idleDeadlineAt'> {
  const ownership = session.owned ? 'owned' : 'borrowed';
  return {
    ...session,
    contextId: currentContextId,
    ownership,
    lifecycle: getLeaseLifecycle(key, session.kind),
    windowRole: getWindowRole(key, ownership),
  };
}

function emptyRegistry(): StoredRegistry {
  return {
    version: 2,
    contextId: currentContextId,
    ownedContainers: {
      interactive: {
        windowId: ownedContainers.interactive.windowId,
        groupId: ownedContainers.interactive.groupId,
      },
      automation: {
        windowId: ownedContainers.automation.windowId,
        groupId: ownedContainers.automation.groupId,
      },
    },
    leases: {},
  };
}

async function readRegistry(): Promise<StoredRegistry> {
  try {
    const local = chrome.storage?.local;
    if (!local) return emptyRegistry();
    const raw = await local.get(REGISTRY_KEY) as Record<string, unknown>;
    const stored = raw[REGISTRY_KEY] as Partial<StoredRegistry> | undefined;
    if (!stored || stored.version !== 2 || typeof stored.leases !== 'object') return emptyRegistry();
    const storedContainers = stored.ownedContainers && typeof stored.ownedContainers === 'object'
      ? stored.ownedContainers
      : emptyRegistry().ownedContainers;
    return {
      version: 2,
      contextId: currentContextId,
      ownedContainers: {
        interactive: {
          windowId: typeof storedContainers.interactive?.windowId === 'number' ? storedContainers.interactive.windowId : null,
          groupId: typeof storedContainers.interactive?.groupId === 'number' ? storedContainers.interactive.groupId : null,
        },
        automation: {
          windowId: typeof storedContainers.automation?.windowId === 'number' ? storedContainers.automation.windowId : null,
          groupId: typeof storedContainers.automation?.groupId === 'number' ? storedContainers.automation.groupId : null,
        },
      },
      leases: stored.leases as Record<string, StoredLease>,
    };
  } catch {
    return emptyRegistry();
  }
}

async function writeRegistry(registry: StoredRegistry): Promise<void> {
  try {
    await chrome.storage?.local?.set({ [REGISTRY_KEY]: registry });
  } catch {
    // Registry persistence is a recovery aid; command execution should not fail on storage errors.
  }
}

async function persistRuntimeState(): Promise<void> {
  const leases: Record<string, StoredLease> = {};
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
      updatedAt: Date.now(),
    };
  }
  await writeRegistry({
    version: 2,
    contextId: currentContextId,
    ownedContainers: {
      interactive: {
        windowId: ownedContainers.interactive.windowId,
        groupId: ownedContainers.interactive.groupId,
      },
      automation: {
        windowId: ownedContainers.automation.windowId,
        groupId: ownedContainers.automation.groupId,
      },
    },
    leases,
  });
}

function scheduleIdleAlarm(leaseKey: string, timeout: number): void {
  const alarmName = makeAlarmName(leaseKey);
  try {
    if (timeout > 0) {
      chrome.alarms?.create?.(alarmName, { when: Date.now() + timeout });
    } else {
      chrome.alarms?.clear?.(alarmName);
    }
  } catch {
    // setTimeout remains the in-process fast path; alarms are the MV3 restart recovery path.
  }
}

async function safeDetach(tabId: number): Promise<void> {
  try {
    const detach = (executor as unknown as { detach?: (tabId: number) => Promise<void> }).detach;
    if (typeof detach === 'function') await detach(tabId);
  } catch {
    // Detach is best-effort during cleanup.
  }
}

async function removeLeaseSession(leaseKey: string): Promise<void> {
  const existing = automationSessions.get(leaseKey);
  if (existing?.idleTimer) clearTimeout(existing.idleTimer);
  automationSessions.delete(leaseKey);
  sessionTimeoutOverrides.delete(leaseKey);
  sessionWindowModeOverrides.delete(leaseKey);
  sessionLifecycleOverrides.delete(leaseKey);
  scheduleIdleAlarm(leaseKey, IDLE_TIMEOUT_NONE);
  await persistRuntimeState();
}

function resetWindowIdleTimer(leaseKey: string): void {
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
    await releaseLease(leaseKey, 'idle timeout');
  }, timeout);
}

async function getOwnedContainerGroupId(role: OwnedWindowRole, windowId: number): Promise<number | null> {
  const container = ownedContainers[role];
  if (container.groupId !== null) {
    try {
      const group = await chrome.tabGroups.get(container.groupId);
      if (group.windowId === windowId) return container.groupId;
    } catch {
      // Group IDs are browser-session state and can disappear when the last tab closes.
    }
    container.groupId = null;
  }

  const groups = await chrome.tabGroups.query({ windowId, title: CONTAINER_TAB_GROUP_TITLE[role] });
  const existing = groups[0];
  if (!existing) return null;
  container.groupId = existing.id;
  return existing.id;
}

async function ensureOwnedContainerTabGroup(role: OwnedWindowRole, windowId: number, tabIds: Array<number | undefined>): Promise<void> {
  const ids = [...new Set(tabIds.filter((id): id is number => id !== undefined))];
  if (ids.length === 0) return;

  try {
    const existingGroupId = await getOwnedContainerGroupId(role, windowId);
    if (existingGroupId !== null) {
      const tabs = await chrome.tabs.query({ windowId });
      const alreadyGrouped = new Set(
        tabs
          .filter((tab) => tab.id !== undefined && ids.includes(tab.id) && tab.groupId === existingGroupId)
          .map((tab) => tab.id!),
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
      collapsed: false,
    });
  } catch (err) {
    console.warn(`[opencli] Failed to mark ${role} tab group: ${err instanceof Error ? err.message : String(err)}`);
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
async function ensureOwnedContainerWindow(
  role: OwnedWindowRole,
  initialUrl?: string,
  mode: WindowMode = 'background',
): Promise<{ windowId: number; initialTabId?: number }> {
  const container = ownedContainers[role];
  if (container.promise) return container.promise;
  container.promise = ensureOwnedContainerWindowUnlocked(role, initialUrl, mode)
    .finally(() => {
      container.promise = null;
    });
  return container.promise;
}

async function ensureOwnedContainerWindowUnlocked(
  role: OwnedWindowRole,
  initialUrl?: string,
  mode: WindowMode = 'background',
): Promise<{ windowId: number; initialTabId?: number }> {
  const container = ownedContainers[role];
  if (container.windowId !== null) {
    try {
      await chrome.windows.get(container.windowId);
      if (mode === 'foreground') {
        const updateWindow = (chrome.windows as unknown as { update?: (windowId: number, updateInfo: { focused?: boolean }) => Promise<unknown> }).update;
        if (typeof updateWindow === 'function') await updateWindow(container.windowId, { focused: true }).catch(() => {});
      }
      const initialTabId = await findReusableOwnedContainerTab(container.windowId);
      await ensureOwnedContainerTabGroup(role, container.windowId, [initialTabId]);
      return {
        windowId: container.windowId,
        initialTabId,
      };
    } catch {
      container.windowId = null;
      container.groupId = null;
    }
  }

  const startUrl = (initialUrl && isSafeNavigationUrl(initialUrl)) ? initialUrl : BLANK_PAGE;

  // Note: Do NOT set `state` parameter here. Chrome 146+ rejects 'normal' as an invalid
  // state value for windows.create(). The window defaults to 'normal' state anyway.
  const win = await chrome.windows.create({
    url: startUrl,
    focused: mode === 'foreground',
    width: 1280,
    height: 900,
    type: 'normal',
  });
  container.windowId = win.id!;
  console.log(`[opencli] Created owned ${role} window ${container.windowId} (start=${startUrl})`);

  // Wait for the initial tab to finish loading instead of a fixed 200ms sleep.
  const tabs = await chrome.tabs.query({ windowId: win.id! });
  const initialTabId = tabs[0]?.id;
  if (initialTabId) {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 500); // fallback cap
      const listener = (tabId: number, info: chrome.tabs.TabChangeInfo) => {
        if (tabId === initialTabId && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          clearTimeout(timeout);
          resolve();
        }
      };
      // Check if already complete before listening
      if (tabs[0].status === 'complete') {
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

async function findReusableOwnedContainerTab(windowId: number): Promise<number | undefined> {
  try {
    const tabs = await chrome.tabs.query({ windowId });
    const reusable = tabs.find(tab =>
      tab.id !== undefined &&
      initialTabIsAvailable(tab.id) &&
      isDebuggableUrl(tab.url),
    );
    return reusable?.id;
  } catch {
    return undefined;
  }
}

function initialTabIsAvailable(tabId: number | undefined): tabId is number {
  if (tabId === undefined) return false;
  for (const session of automationSessions.values()) {
    if (session.owned && session.preferredTabId === tabId) return false;
  }
  return true;
}

async function createOwnedTabLease(leaseKey: string, initialUrl?: string): Promise<ResolvedTab> {
  return withLeaseMutation(() => createOwnedTabLeaseUnlocked(leaseKey, initialUrl));
}

async function createOwnedTabLeaseUnlocked(leaseKey: string, initialUrl?: string): Promise<ResolvedTab> {
  const targetUrl = (initialUrl && isSafeNavigationUrl(initialUrl)) ? initialUrl : BLANK_PAGE;
  const role = getOwnedWindowRole(leaseKey);
  const { windowId, initialTabId } = await ensureOwnedContainerWindow(role, targetUrl, getWindowMode(leaseKey));
  let tab: chrome.tabs.Tab;

  if (initialTabIsAvailable(initialTabId)) {
    tab = await chrome.tabs.get(initialTabId);
    if (!isTargetUrl(tab.url, targetUrl)) {
      tab = await chrome.tabs.update(initialTabId, { url: targetUrl });
      await new Promise(resolve => setTimeout(resolve, 300));
      tab = await chrome.tabs.get(initialTabId);
    }
  } else {
    tab = await chrome.tabs.create({ windowId, url: targetUrl, active: true });
  }
  if (!tab.id) throw new Error('Failed to create tab lease in automation container');
  await ensureOwnedContainerTabGroup(role, windowId, [tab.id]);

  setLeaseSession(leaseKey, {
    session: getSessionFromKey(leaseKey),
    surface: getSurfaceFromKey(leaseKey),
    kind: 'owned',
    windowId,
    owned: true,
    preferredTabId: tab.id,
  });
  resetWindowIdleTimer(leaseKey);
  return { tabId: tab.id, tab };
}

/** Get or create the dedicated automation container window.
 *  This compatibility helper returns the shared owned container. Leases
 *  lease tabs inside it instead of owning separate windows.
 */
async function getAutomationWindow(leaseKey: string, initialUrl?: string): Promise<number> {
  // Check if our window is still alive.
  const existing = automationSessions.get(leaseKey);
  if (existing) {
    if (!existing.owned) {
      throw new CommandFailure(
        'bound_window_operation_blocked',
        `Session "${existing.session}" is bound to a user tab and does not own an OpenCLI tab lease.`,
        'Use page commands on the bound tab, or unbind the session first.',
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
      // Tab/window was closed by user
      await removeLeaseSession(leaseKey);
    }
  }

  const role = getOwnedWindowRole(leaseKey);
  return (await ensureOwnedContainerWindow(role, initialUrl, getWindowMode(leaseKey))).windowId;
}

// Clean up when an owned container window is closed
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

// Evict identity mappings when tabs are closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  identity.evictTab(tabId);
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

// ─── Lifecycle events ────────────────────────────────────────────────

let initialized = false;

function initialize(): void {
  if (initialized) return;
  initialized = true;
  chrome.alarms.create('keepalive', { periodInMinutes: 0.4 }); // ~24 seconds
  executor.registerListeners();
  try {
    const registerFrameTracking = (executor as { registerFrameTracking?: () => void }).registerFrameTracking;
    registerFrameTracking?.();
  } catch {
    // Some focused tests mock only the cdp functions they exercise.
  }
  void (async () => {
    await getCurrentContextId();
    await reconcileTargetLeaseRegistry();
    await connect();
  })();
  console.log('[opencli] OpenCLI extension initialized');
}

chrome.runtime.onInstalled.addListener(() => {
  initialize();
});

chrome.runtime.onStartup.addListener(() => {
  initialize();
});

// MV3 service workers can be started by events other than install/startup
// (including unpacked-extension e2e launches). Initialize on every worker load;
// initialize() is idempotent, so lifecycle events remain harmless.
initialize();

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'keepalive') void connect();
  const leaseKey = leaseKeyFromAlarmName(alarm.name);
  if (leaseKey) await releaseLease(leaseKey, 'idle alarm');
});

// ─── Popup status API ───────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'getStatus') {
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
        daemonVersion,
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
async function fetchDaemonVersion(): Promise<string | null> {
  try {
    const res = await fetch(`http://${DAEMON_HOST}:${DAEMON_PORT}/status`, {
      method: 'GET',
      headers: { 'X-OpenCLI': '1' },
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return null;
    const body = await res.json() as { daemonVersion?: unknown };
    return typeof body.daemonVersion === 'string' ? body.daemonVersion : null;
  } catch {
    return null;
  }
}

// ─── Command dispatcher ─────────────────────────────────────────────

async function handleCommand(cmd: Command): Promise<Result> {
  const session = getSessionName(cmd.session);
  const surface = getCommandSurface(cmd);
  const leaseKey = getLeaseKey(session, surface);
  if (cmd.windowMode === 'foreground' || cmd.windowMode === 'background') {
    sessionWindowModeOverrides.set(leaseKey, cmd.windowMode);
  }
  if (surface === 'adapter' && (cmd.siteSession === 'persistent' || cmd.siteSession === 'ephemeral')) {
    sessionLifecycleOverrides.set(leaseKey, cmd.siteSession);
  }
  // Apply custom idle timeout if specified in the command
  if (cmd.idleTimeout != null && cmd.idleTimeout > 0) {
    sessionTimeoutOverrides.set(leaseKey, cmd.idleTimeout * 1000);
  }
  // Reset idle timer on every command (window stays alive while active)
  resetWindowIdleTimer(leaseKey);
  try {
    switch (cmd.action) {
      case 'exec':
        return await handleExec(cmd, leaseKey);
      case 'navigate':
        return await handleNavigate(cmd, leaseKey);
      case 'tabs':
        return await handleTabs(cmd, leaseKey);
      case 'cookies':
        return await handleCookies(cmd);
      case 'screenshot':
        return await handleScreenshot(cmd, leaseKey);
      case 'close-window':
        return await handleCloseWindow(cmd, leaseKey);
      case 'cdp':
        return await handleCdp(cmd, leaseKey);
      case 'sessions':
        return await handleSessions(cmd);
      case 'set-file-input':
        return await handleSetFileInput(cmd, leaseKey);
      case 'insert-text':
        return await handleInsertText(cmd, leaseKey);
      case 'bind':
        return await handleBind(cmd, leaseKey);
      case 'network-capture-start':
        return await handleNetworkCaptureStart(cmd, leaseKey);
      case 'network-capture-read':
        return await handleNetworkCaptureRead(cmd, leaseKey);
      case 'wait-download':
        return await handleWaitDownload(cmd);
      case 'frames':
        return await handleFrames(cmd, leaseKey);
      default:
        return { id: cmd.id, ok: false, error: `Unknown action: ${cmd.action}` };
    }
  } catch (err) {
    return {
      id: cmd.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ...(err instanceof CommandFailure ? { errorCode: err.code } : {}),
      ...(err instanceof CommandFailure && err.hint ? { errorHint: err.hint } : {}),
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

/** Check if a URL is safe for user-facing navigation (http/https only). */
function isSafeNavigationUrl(url: string): boolean {
  return url.startsWith('http://') || url.startsWith('https://');
}

/** Minimal URL normalization for same-page comparison: root slash + default port only. */
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

function getUrlOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function enumerateCrossOriginFrames(tree: any): Array<{ index: number; frameId: string; url: string; name: string }> {
  const frames: Array<{ index: number; frameId: string; url: string; name: string }> = [];

  function collect(node: any, accessibleOrigin: string | null) {
    for (const child of (node.childFrames || [])) {
      const frame = child.frame;
      const frameUrl = frame.url || frame.unreachableUrl || '';
      const frameOrigin = getUrlOrigin(frameUrl);

      // Mirror dom-snapshot's [F#] rules:
      // - same-origin frames expand inline and do not get an [F#] slot
      // - cross-origin / blocked frames get one slot and stop recursion there
      if (accessibleOrigin && frameOrigin && frameOrigin === accessibleOrigin) {
        collect(child, frameOrigin);
        continue;
      }

      frames.push({
        index: frames.length,
        frameId: frame.id,
        url: frameUrl,
        name: frame.name || '',
      });
    }
  }

  const rootFrame = tree?.frameTree?.frame;
  const rootUrl = rootFrame?.url || rootFrame?.unreachableUrl || '';
  collect(tree.frameTree, getUrlOrigin(rootUrl));
  return frames;
}

function setLeaseSession(
  leaseKey: string,
  session: Omit<TargetLease, 'idleTimer' | 'idleDeadlineAt' | 'contextId' | 'ownership' | 'lifecycle' | 'windowRole'>,
): void {
  const existing = automationSessions.get(leaseKey);
  if (existing?.idleTimer) clearTimeout(existing.idleTimer);
  const timeout = getIdleTimeout(leaseKey);
  automationSessions.set(leaseKey, {
    ...makeSession(leaseKey, session),
    idleTimer: null,
    idleDeadlineAt: timeout <= 0 ? 0 : Date.now() + timeout,
  });
  void persistRuntimeState();
}

/**
 * Resolve tabId from command's page (targetId).
 * Returns undefined if no page identity is provided.
 */
async function resolveCommandTabId(cmd: Command): Promise<number | undefined> {
  if (cmd.page) return identity.resolveTabId(cmd.page);
  return undefined;
}

type ResolvedTab = { tabId: number; tab: chrome.tabs.Tab | null };

/**
 * Resolve target tab for the session lease, returning both the tabId and
 * the Tab object (when available) so callers can skip a redundant chrome.tabs.get().
 */
async function resolveTab(tabId: number | undefined, leaseKey: string, initialUrl?: string): Promise<ResolvedTab> {
  const existingSession = automationSessions.get(leaseKey);
  // Even when an explicit tabId is provided, validate it is still debuggable.
  if (tabId !== undefined) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const session = existingSession;
      const matchesSession = session
        ? (session.preferredTabId !== null ? session.preferredTabId === tabId : tab.windowId === session.windowId)
        : false;
      if (isDebuggableUrl(tab.url) && matchesSession) return { tabId, tab };
      if (session && !session.owned) {
        throw new CommandFailure(
          matchesSession ? 'bound_tab_not_debuggable' : 'bound_tab_mismatch',
          matchesSession
            ? `Bound tab for session "${session.session}" is not debuggable (${tab.url ?? 'unknown URL'}).`
            : `Target tab is not the tab bound to session "${session.session}".`,
          'Run "opencli browser bind" again on a debuggable http(s) tab.',
        );
      }
      if (session && !matchesSession && session.preferredTabId === null && isDebuggableUrl(tab.url)) {
        // Tab drifted to another window but content is still valid.
        // Try to move it back instead of abandoning it.
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
          'bound_tab_gone',
          `Bound tab for session "${existingSession.session}" no longer exists.`,
          'Run "opencli browser bind" again, then retry the command.',
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
      if (isDebuggableUrl(preferredTab.url)) return { tabId: preferredTab.id!, tab: preferredTab };
      if (!session.owned) {
        throw new CommandFailure(
          'bound_tab_not_debuggable',
          `Bound tab for session "${session.session}" is not debuggable (${preferredTab.url ?? 'unknown URL'}).`,
          'Switch the tab to an http(s) page or run "opencli browser bind" on another tab.',
        );
      }
    } catch (err) {
      if (err instanceof CommandFailure) throw err;
      await removeLeaseSession(leaseKey);
      if (!session.owned) {
        throw new CommandFailure(
          'bound_tab_gone',
          `Bound tab for session "${session.session}" no longer exists.`,
          'Run "opencli browser bind" again, then retry the command.',
        );
      }
      return createOwnedTabLease(leaseKey, initialUrl);
    }
  }

  if (!existingSession || (existingSession.owned && existingSession.preferredTabId === null)) {
    return createOwnedTabLease(leaseKey, initialUrl);
  }

  // Get (or create) the dedicated automation container
  const windowId = await getAutomationWindow(leaseKey, initialUrl);

  // Prefer an existing debuggable tab
  const tabs = await chrome.tabs.query({ windowId });
  const debuggableTab = tabs.find(t => t.id && isDebuggableUrl(t.url));
  if (debuggableTab?.id) return { tabId: debuggableTab.id, tab: debuggableTab };

  // No debuggable tab — another extension may have hijacked the tab URL.
  const reuseTab = tabs.find(t => t.id);
  if (reuseTab?.id) {
    await chrome.tabs.update(reuseTab.id, { url: BLANK_PAGE });
    await new Promise(resolve => setTimeout(resolve, 300));
    try {
      const updated = await chrome.tabs.get(reuseTab.id);
      if (isDebuggableUrl(updated.url)) return { tabId: reuseTab.id, tab: updated };
      console.warn(`[opencli] data: URI was intercepted (${updated.url}), creating fresh tab`);
    } catch {
      // Tab was closed during navigation
    }
  }

  // Fallback: create a new tab
  const newTab = await chrome.tabs.create({ windowId, url: BLANK_PAGE, active: true });
  if (!newTab.id) throw new Error('Failed to create tab in automation container');
  return { tabId: newTab.id, tab: newTab };
}

/** Build a page-scoped success result with targetId resolved from tabId */
async function pageScopedResult(id: string, tabId: number, data?: unknown): Promise<Result> {
  const page = await identity.resolveTargetId(tabId);
  const lease = [...automationSessions.values()].find((session) => session.preferredTabId === tabId);
  const scopedData = data && typeof data === 'object' && !Array.isArray(data)
    ? { session: lease?.session, ...(data as Record<string, unknown>) }
    : { session: lease?.session, data };
  return { id, ok: true, data: scopedData, page };
}

/** Convenience wrapper returning just the tabId (used by most handlers) */
async function resolveTabId(tabId: number | undefined, leaseKey: string, initialUrl?: string): Promise<number> {
  const resolved = await resolveTab(tabId, leaseKey, initialUrl);
  return resolved.tabId;
}

async function listAutomationTabs(leaseKey: string): Promise<chrome.tabs.Tab[]> {
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

async function listAutomationWebTabs(leaseKey: string): Promise<chrome.tabs.Tab[]> {
  const tabs = await listAutomationTabs(leaseKey);
  return tabs.filter((tab) => isDebuggableUrl(tab.url));
}

async function handleExec(cmd: Command, leaseKey: string): Promise<Result> {
  if (!cmd.code) return { id: cmd.id, ok: false, error: 'Missing code' };
  const cmdTabId = await resolveCommandTabId(cmd);
  const tabId = await resolveTabId(cmdTabId, leaseKey);
  try {
    const aggressive = getSurfaceFromKey(leaseKey) === 'browser';
    if (cmd.frameIndex != null) {
      const tree = await executor.getFrameTree(tabId);
      const frames = enumerateCrossOriginFrames(tree);
      if (cmd.frameIndex < 0 || cmd.frameIndex >= frames.length) {
        return { id: cmd.id, ok: false, error: `Frame index ${cmd.frameIndex} out of range (${frames.length} cross-origin frames available)` };
      }
      const data = await executor.evaluateInFrame(tabId, cmd.code, frames[cmd.frameIndex].frameId, aggressive);
      return pageScopedResult(cmd.id, tabId, data);
    }
    const data = await executor.evaluateAsync(tabId, cmd.code, aggressive);
    return pageScopedResult(cmd.id, tabId, data);
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleFrames(cmd: Command, leaseKey: string): Promise<Result> {
  const cmdTabId = await resolveCommandTabId(cmd);
  const tabId = await resolveTabId(cmdTabId, leaseKey);
  try {
    const tree = await executor.getFrameTree(tabId);
    return { id: cmd.id, ok: true, data: enumerateCrossOriginFrames(tree) };
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleNavigate(cmd: Command, leaseKey: string): Promise<Result> {
  if (!cmd.url) return { id: cmd.id, ok: false, error: 'Missing url' };
  if (!isSafeNavigationUrl(cmd.url)) {
    return { id: cmd.id, ok: false, error: 'Blocked URL scheme -- only http:// and https:// are allowed' };
  }
  // Pass target URL so that first-time window creation can start on the right domain
  const cmdTabId = await resolveCommandTabId(cmd);
  const resolved = await resolveTab(cmdTabId, leaseKey, cmd.url);
  const tabId = resolved.tabId;

  const beforeTab = resolved.tab ?? await chrome.tabs.get(tabId);
  const beforeNormalized = normalizeUrlForComparison(beforeTab.url);
  const targetUrl = cmd.url;

  // Fast-path: tab is already at the target URL and fully loaded.
  if (beforeTab.status === 'complete' && isTargetUrl(beforeTab.url, targetUrl)) {
    return pageScopedResult(cmd.id, tabId, { title: beforeTab.title, url: beforeTab.url, timedOut: false });
  }

  // Detach any existing debugger before top-level navigation unless network
  // capture is already armed on this tab. Otherwise we would clear the capture
  // state right before the page load we are trying to observe.
  // Some sites (observed on creator.xiaohongshu.com flows) can invalidate the
  // current inspected target during navigation, which leaves a stale CDP attach
  // state and causes the next Runtime.evaluate to fail with
  // "Inspected target navigated or closed". Resetting here forces a clean
  // re-attach after navigation when capture is not active.
  if (!executor.hasActiveNetworkCapture(tabId)) {
    await executor.detach(tabId);
  }

  await chrome.tabs.update(tabId, { url: targetUrl });

  // Wait until navigation completes. Resolve when status is 'complete' AND either:
  // - the URL matches the target (handles same-URL / canonicalized navigations), OR
  // - the URL differs from the pre-navigation URL (handles redirects).
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
      if (info.status === 'complete' && isNavigationDone(tab.url ?? info.url)) {
        finish();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);

    // Also check if the tab already navigated (e.g. instant cache hit)
    checkTimer = setTimeout(async () => {
      try {
        const currentTab = await chrome.tabs.get(tabId);
        if (currentTab.status === 'complete' && isNavigationDone(currentTab.url)) {
          finish();
        }
      } catch { /* tab gone */ }
    }, 100);

    // Timeout fallback with warning
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      console.warn(`[opencli] Navigate to ${targetUrl} timed out after 15s`);
      finish();
    }, 15000);
  });

  let tab = await chrome.tabs.get(tabId);

  // Post-navigation drift detection: if the tab moved to another window
  // during navigation (e.g. a tab-management extension regrouped it),
  // try to move it back to maintain session isolation.
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

async function handleTabs(cmd: Command, leaseKey: string): Promise<Result> {
  const session = automationSessions.get(leaseKey);
  if (session && !session.owned && cmd.op !== 'list') {
    return {
      id: cmd.id,
      ok: false,
      errorCode: 'bound_tab_mutation_blocked',
      error: `Session "${session.session}" is bound to a user tab; tab new/select/close requires an owned OpenCLI session.`,
      errorHint: 'Unbind the session first, or use a different session for owned OpenCLI tabs.',
    };
  }
  switch (cmd.op) {
    case 'list': {
      const tabs = await listAutomationWebTabs(leaseKey);
      const data = await Promise.all(tabs.map(async (t, i) => {
        let page: string | undefined;
        try { page = t.id ? await identity.resolveTargetId(t.id) : undefined; } catch { /* skip */ }
        return { index: i, page, url: t.url, title: t.title, active: t.active };
      }));
      return { id: cmd.id, ok: true, data };
    }
    case 'new': {
      if (cmd.url && !isSafeNavigationUrl(cmd.url)) {
        return { id: cmd.id, ok: false, error: 'Blocked URL scheme -- only http:// and https:// are allowed' };
      }
      if (!automationSessions.has(leaseKey)) {
        const created = await createOwnedTabLease(leaseKey, cmd.url);
        return pageScopedResult(cmd.id, created.tabId, { url: created.tab?.url });
      }
      const windowId = await getAutomationWindow(leaseKey);
      const tab = await chrome.tabs.create({ windowId, url: cmd.url ?? BLANK_PAGE, active: true });
      if (!tab.id) return { id: cmd.id, ok: false, error: 'Failed to create tab' };
      await ensureOwnedContainerTabGroup(getOwnedWindowRole(leaseKey), windowId, [tab.id]);
      setLeaseSession(leaseKey, {
        session: getSessionFromKey(leaseKey),
        surface: getSurfaceFromKey(leaseKey),
        kind: 'owned',
        windowId: tab.windowId,
        owned: true,
        preferredTabId: tab.id,
      });
      resetWindowIdleTimer(leaseKey);
      return pageScopedResult(cmd.id, tab.id, { url: tab.url });
    }
    case 'close': {
      if (cmd.index !== undefined) {
        const tabs = await listAutomationWebTabs(leaseKey);
        const target = tabs[cmd.index];
        if (!target?.id) return { id: cmd.id, ok: false, error: `Tab index ${cmd.index} not found` };
        const closedPage = await identity.resolveTargetId(target.id).catch(() => undefined);
        const currentSession = automationSessions.get(leaseKey);
        if (currentSession?.preferredTabId === target.id) {
          await releaseLease(leaseKey, 'tab close');
        } else {
          await safeDetach(target.id);
          await chrome.tabs.remove(target.id);
        }
        return { id: cmd.id, ok: true, data: { closed: closedPage } };
      }
      const cmdTabId = await resolveCommandTabId(cmd);
      const tabId = await resolveTabId(cmdTabId, leaseKey);
      const closedPage = await identity.resolveTargetId(tabId).catch(() => undefined);
      const currentSession = automationSessions.get(leaseKey);
      if (currentSession?.preferredTabId === tabId) {
        await releaseLease(leaseKey, 'tab close');
      } else {
        await safeDetach(tabId);
        await chrome.tabs.remove(tabId);
      }
      return { id: cmd.id, ok: true, data: { closed: closedPage } };
    }
    case 'select': {
      if (cmd.index === undefined && cmd.page === undefined)
        return { id: cmd.id, ok: false, error: 'Missing index or page' };
      const cmdTabId = await resolveCommandTabId(cmd);
      if (cmdTabId !== undefined) {
        const session = automationSessions.get(leaseKey);
        let tab: chrome.tabs.Tab;
        try {
          tab = await chrome.tabs.get(cmdTabId);
        } catch {
          return { id: cmd.id, ok: false, error: `Page no longer exists` };
        }
        if (!session || tab.windowId !== session.windowId) {
          return { id: cmd.id, ok: false, error: `Page is not in the automation container` };
        }
        await chrome.tabs.update(cmdTabId, { active: true });
        return pageScopedResult(cmd.id, cmdTabId, { selected: true });
      }
      const tabs = await listAutomationWebTabs(leaseKey);
      const target = tabs[cmd.index!];
      if (!target?.id) return { id: cmd.id, ok: false, error: `Tab index ${cmd.index} not found` };
      await chrome.tabs.update(target.id, { active: true });
      return pageScopedResult(cmd.id, target.id, { selected: true });
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

async function handleScreenshot(cmd: Command, leaseKey: string): Promise<Result> {
  const cmdTabId = await resolveCommandTabId(cmd);
  const tabId = await resolveTabId(cmdTabId, leaseKey);
  try {
    const data = await executor.screenshot(tabId, {
      format: cmd.format,
      quality: cmd.quality,
      fullPage: cmd.fullPage,
      width: cmd.width,
      height: cmd.height,
    });
    return pageScopedResult(cmd.id, tabId, data);
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** CDP methods permitted via the 'cdp' passthrough action. */
const CDP_ALLOWLIST = new Set([
  // Agent DOM context
  'Accessibility.enable',
  'Accessibility.getFullAXTree',
  'DOM.enable',
  'DOM.getDocument',
  'DOM.getBoxModel',
  'DOM.getContentQuads',
  'DOM.focus',
  'DOM.querySelector',
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
  'Page.getFrameTree',
  'Page.handleJavaScriptDialog',
  // Runtime.enable needed for CDP attach setup (Runtime.evaluate goes through 'exec' action)
  'Runtime.enable',
  // Emulation (used by screenshot full-page)
  'Emulation.setDeviceMetricsOverride',
  'Emulation.clearDeviceMetricsOverride',
]);

async function handleCdp(cmd: Command, leaseKey: string): Promise<Result> {
  if (!cmd.cdpMethod) return { id: cmd.id, ok: false, error: 'Missing cdpMethod' };
  if (!CDP_ALLOWLIST.has(cmd.cdpMethod)) {
    return { id: cmd.id, ok: false, error: `CDP method not permitted: ${cmd.cdpMethod}` };
  }
  const cmdTabId = await resolveCommandTabId(cmd);
  const tabId = await resolveTabId(cmdTabId, leaseKey);
  try {
    const aggressive = getSurfaceFromKey(leaseKey) === 'browser';
    await executor.ensureAttached(tabId, aggressive);
    const params = cmd.cdpParams ?? {};
    const routeFrameId = typeof params.frameId === 'string' && params.sessionId === 'target'
      ? params.frameId
      : undefined;
    const routeTargetUrl = typeof params.targetUrl === 'string' ? params.targetUrl : undefined;
    const data = routeFrameId
      ? await executor.sendCommandInFrameTarget(tabId, routeFrameId, cmd.cdpMethod, stripOpenCliFrameRoutingParams(params, true), aggressive, 30_000, routeTargetUrl)
      : await chrome.debugger.sendCommand(
        { tabId },
        cmd.cdpMethod,
        stripOpenCliFrameRoutingParams(params, false),
      );
    return pageScopedResult(cmd.id, tabId, data);
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

function stripOpenCliFrameRoutingParams(params: Record<string, unknown>, stripFrameId: boolean): Record<string, unknown> {
  const { sessionId, frameId, targetUrl, ...rest } = params;
  if (!stripFrameId && frameId !== undefined) return { ...rest, frameId };
  return rest;
}

async function handleCloseWindow(cmd: Command, leaseKey: string): Promise<Result> {
  const sessionName = automationSessions.get(leaseKey)?.session ?? getSessionFromKey(leaseKey);
  await releaseLease(leaseKey, 'explicit close');
  return { id: cmd.id, ok: true, data: { closed: true, session: sessionName } };
}

async function handleSetFileInput(cmd: Command, leaseKey: string): Promise<Result> {
  if (!cmd.files || !Array.isArray(cmd.files) || cmd.files.length === 0) {
    return { id: cmd.id, ok: false, error: 'Missing or empty files array' };
  }
  const cmdTabId = await resolveCommandTabId(cmd);
  const tabId = await resolveTabId(cmdTabId, leaseKey);
  try {
    await executor.setFileInputFiles(tabId, cmd.files, cmd.selector);
    return pageScopedResult(cmd.id, tabId, { count: cmd.files.length });
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleInsertText(cmd: Command, leaseKey: string): Promise<Result> {
  if (typeof cmd.text !== 'string') {
    return { id: cmd.id, ok: false, error: 'Missing text payload' };
  }
  const cmdTabId = await resolveCommandTabId(cmd);
  const tabId = await resolveTabId(cmdTabId, leaseKey);
  try {
    await executor.insertText(tabId, cmd.text);
    return pageScopedResult(cmd.id, tabId, { inserted: true });
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleNetworkCaptureStart(cmd: Command, leaseKey: string): Promise<Result> {
  const cmdTabId = await resolveCommandTabId(cmd);
  const tabId = await resolveTabId(cmdTabId, leaseKey);
  try {
    await executor.startNetworkCapture(tabId, cmd.pattern);
    return pageScopedResult(cmd.id, tabId, { started: true });
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleNetworkCaptureRead(cmd: Command, leaseKey: string): Promise<Result> {
  const cmdTabId = await resolveCommandTabId(cmd);
  const tabId = await resolveTabId(cmdTabId, leaseKey);
  try {
    const data = await executor.readNetworkCapture(tabId);
    return pageScopedResult(cmd.id, tabId, data);
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function handleWaitDownload(cmd: Command): Promise<Result> {
  try {
    const data = await executor.waitForDownload(cmd.pattern ?? '', cmd.timeoutMs ?? 30000);
    return { id: cmd.id, ok: true, data };
  } catch (err) {
    return { id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function releaseLease(leaseKey: string, reason: string = 'released'): Promise<void> {
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
      const hasOtherOwnedLease = [...automationSessions.entries()].some(([otherLease, otherSession]) =>
        otherLease !== leaseKey &&
        otherSession.owned &&
        otherSession.windowId === session.windowId &&
        otherSession.preferredTabId !== null,
      );
      await safeDetach(tabId);
      identity.evictTab(tabId);
      if (hasOtherOwnedLease) {
        await chrome.tabs.remove(tabId).catch(() => {});
        console.log(`[opencli] Released owned tab lease ${tabId} (session=${session.session}, surface=${session.surface}, ${reason})`);
      } else {
        try {
          const tab = await chrome.tabs.update(tabId, { url: BLANK_PAGE, active: true });
          await ensureOwnedContainerTabGroup(getOwnedWindowRole(leaseKey), session.windowId, [tab.id ?? tabId]);
          console.log(`[opencli] Released owned tab lease ${tabId} as reusable placeholder (session=${session.session}, surface=${session.surface}, ${reason})`);
        } catch {
          await chrome.tabs.remove(tabId).catch(() => {});
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

async function reconcileTargetLeaseRegistry(): Promise<void> {
  const registry = await readRegistry();
  for (const role of Object.keys(ownedContainers) as OwnedWindowRole[]) {
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
      if (stored.lifecycle === 'ephemeral' || stored.lifecycle === 'persistent' || stored.lifecycle === 'pinned') {
        sessionLifecycleOverrides.set(leaseKey, stored.lifecycle);
      }
      const session = makeSession(leaseKey, {
        session: typeof stored.session === 'string' ? stored.session : getSessionFromKey(leaseKey),
        surface: stored.surface === 'adapter' ? 'adapter' : getSurfaceFromKey(leaseKey),
        kind: stored.kind === 'bound' || stored.owned === false ? 'bound' : 'owned',
        windowId: tab.windowId,
        owned: stored.owned,
        preferredTabId: tabId,
      });
      const timeout = getIdleTimeout(leaseKey);
      automationSessions.set(leaseKey, {
        ...session,
        idleTimer: null,
        idleDeadlineAt: stored.idleDeadlineAt,
      });
      if (session.owned) {
        const role = getOwnedWindowRole(leaseKey);
        if (ownedContainers[role].windowId === null) ownedContainers[role].windowId = tab.windowId;
        await ensureOwnedContainerTabGroup(role, tab.windowId, [tabId]);
      }
      const remaining = stored.idleDeadlineAt > 0 ? stored.idleDeadlineAt - Date.now() : timeout;
      if (timeout > 0) {
        if (remaining <= 0) {
          await releaseLease(leaseKey, 'reconciled idle expiry');
        } else {
          resetWindowIdleTimer(leaseKey);
        }
      }
    } catch {
      // Registry is semantic state, not truth. If Chrome no longer has the tab,
      // drop the lease record and never close unrelated user resources.
    }
  }

  await persistRuntimeState();
}

async function handleSessions(cmd: Command): Promise<Result> {
  const now = Date.now();
  const data = await Promise.all([...automationSessions.entries()].map(async ([leaseKey, session]) => ({
    session: session.session,
    windowId: session.windowId,
    owned: session.owned,
    kind: session.kind,
    surface: session.surface,
    preferredTabId: session.preferredTabId,
    contextId: session.contextId,
    ownership: session.ownership,
    lifecycle: session.lifecycle,
    windowRole: session.windowRole,
    tabCount: session.preferredTabId !== null
      ? (await chrome.tabs.get(session.preferredTabId).then((tab) => isDebuggableUrl(tab.url) ? 1 : 0).catch(() => 0))
      : (await chrome.tabs.query({ windowId: session.windowId })).filter((tab) => isDebuggableUrl(tab.url)).length,
    idleMsRemaining: session.idleDeadlineAt <= 0 ? null : Math.max(0, session.idleDeadlineAt - now),
  })));
  return { id: cmd.id, ok: true, data };
}

async function handleBind(cmd: Command, leaseKey: string): Promise<Result> {
  const existing = automationSessions.get(leaseKey);
  if (existing?.owned) {
    await releaseLease(leaseKey, 'rebind');
  }
  const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const fallbackTabs = await chrome.tabs.query({ lastFocusedWindow: true });
  const boundTab = activeTabs.find((tab) => isDebuggableUrl(tab.url))
    ?? fallbackTabs.find((tab) => isDebuggableUrl(tab.url));
  if (!boundTab?.id) {
    return {
      id: cmd.id,
      ok: false,
      errorCode: 'bound_tab_not_found',
      error: 'No debuggable tab found in the current window',
      errorHint: 'Focus the target Chrome tab/window, then retry bind.',
    };
  }

  const current = automationSessions.get(leaseKey);
  if (current && !current.owned && current.preferredTabId !== null && current.preferredTabId !== boundTab.id) {
    await executor.detach(current.preferredTabId).catch(() => {});
  }

  setLeaseSession(leaseKey, {
    session: getSessionFromKey(leaseKey),
    surface: getSurfaceFromKey(leaseKey),
    kind: 'bound',
    windowId: boundTab.windowId,
    owned: false,
    preferredTabId: boundTab.id,
  });
  resetWindowIdleTimer(leaseKey);
  console.log(`[opencli] Session ${getSessionFromKey(leaseKey)} explicitly bound to tab ${boundTab.id} (${boundTab.url})`);
  return pageScopedResult(cmd.id, boundTab.id, {
    url: boundTab.url,
    title: boundTab.title,
    session: getSessionFromKey(leaseKey),
  });
}

export const __test__ = {
  handleExec,
  handleNavigate,
  isTargetUrl,
  handleTabs,
  handleSessions,
  handleBind,
  resolveTabId,
  resetWindowIdleTimer,
  handleCommand,
  getIdleTimeout,
  getLeaseKey,
  sessionTimeoutOverrides,
  reconcileTargetLeaseRegistry,
  getSession: (leaseKey: string = 'default') => automationSessions.get(leaseKey) ?? null,
  getAutomationWindowId: (leaseKey: string = 'default') => automationSessions.get(leaseKey)?.windowId ?? null,
  setAutomationWindowId: (leaseKey: string, windowId: number | null) => {
    if (windowId === null) {
      const session = automationSessions.get(leaseKey);
      if (session?.idleTimer) clearTimeout(session.idleTimer);
      automationSessions.delete(leaseKey);
      return;
    }
    setLeaseSession(leaseKey, {
      session: getSessionFromKey(leaseKey),
      surface: getSurfaceFromKey(leaseKey),
      kind: 'owned',
      windowId,
      owned: true,
      preferredTabId: null,
    });
  },
  setSession: (leaseKey: string, session: { windowId: number; owned: boolean; preferredTabId: number | null }) => {
    setLeaseSession(leaseKey, {
      session: getSessionFromKey(leaseKey),
      surface: getSurfaceFromKey(leaseKey),
      kind: session.owned ? 'owned' : 'bound',
      ...session,
    });
  },
};
