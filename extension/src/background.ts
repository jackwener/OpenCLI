/**
 * OpenCLI — Service Worker (background script).
 *
 * Connects to the opencli daemon via WebSocket, receives commands,
 * dispatches them to Chrome APIs (debugger/tabs/cookies), returns results.
 */

declare const __OPENCLI_COMPAT_RANGE__: string;

import type { Command, Result } from './protocol';
import { DAEMON_HOST, DAEMON_PORT, DAEMON_WS_URL, DAEMON_PING_URL } from './protocol';
import * as executor from './cdp';
import * as identity from './identity';
import { executeWithJournal } from './journal';

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
const CONTEXT_ID_KEY = 'opencli_context_id_v1';
let currentContextId = 'default';
let contextIdPromise: Promise<string> | null = null;
let connectInFlight: Promise<void> | null = null;
// Startup readiness gate. A MV3 service worker can be woken by an event
// (alarm, window/tab removal) before initialize()'s recovery chain has
// rehydrated in-memory lease/container state from storage. Event handlers that
// persist state must `await workerReady` first, or an empty snapshot overwrites
// the persisted registry (wiping self-heal pointers and lease records).
// initialize() replaces this with the real recovery promise; it always
// resolves (never rejects) so gated handlers can never wedge permanently.
let workerReady: Promise<void> = Promise.resolve();
// Synchronous mirror of workerReady's settled state. Lets connect() skip the
// `await workerReady` microtask hop once recovery is done, so the steady-state
// (post-recovery) connect path is byte-for-byte the original — only the
// pre-recovery wake is gated.
let workerRecovered = true;

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
  try {
    const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    safeSend(ws, { type: 'log', level, msg, ts: Date.now() });
  } catch { /* don't recurse */ }
}

function safeSend(socket: WebSocket | null | undefined, payload: unknown): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  try {
    socket.send(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

console.log = (...args: unknown[]) => { _origLog(...args); forwardLog('info', args); };
console.warn = (...args: unknown[]) => { _origWarn(...args); forwardLog('warn', args); };
console.error = (...args: unknown[]) => { _origError(...args); forwardLog('error', args); };

// ─── WebSocket connection ────────────────────────────────────────────

function isDaemonSocketActive(socket: WebSocket | null | undefined = ws): boolean {
  return socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING;
}

/**
 * Probe the daemon via its /ping HTTP endpoint before attempting a WebSocket
 * connection.  fetch() failures are silently catchable; new WebSocket() is not
 * — Chrome logs ERR_CONNECTION_REFUSED to the extension error page before any
 * JS handler can intercept it.  By keeping the probe inside connect() every
 * call site remains unchanged and the guard can never be accidentally skipped.
 */
function connect(): Promise<void> {
  if (isDaemonSocketActive()) return Promise.resolve();
  if (connectInFlight) return connectInFlight;
  // Gate on startup recovery so a keepalive/reconnect wake never opens the
  // socket into an un-rehydrated worker (daemon commands would then run against
  // empty lease state). Once recovered, skip straight to connectAttempt so the
  // steady-state path adds no extra tick. connectInFlight is set synchronously
  // either way, so concurrent callers still coalesce; workerReady excludes
  // connect itself, so no deadlock.
  const attempt = workerRecovered ? connectAttempt() : workerReady.then(() => connectAttempt());
  connectInFlight = attempt.finally(() => {
    connectInFlight = null;
  });
  return connectInFlight;
}

async function connectAttempt(): Promise<void> {
  if (isDaemonSocketActive()) return;

  try {
    const res = await fetch(DAEMON_PING_URL, { signal: AbortSignal.timeout(1000) });
    if (!res.ok) {
      scheduleReconnect();
      return; // unexpected response — not our daemon, but keep polling.
    }
    // Daemon is reachable — proceed straight to the WebSocket below.
    reconnectAttempts = 0;
  } catch {
    scheduleReconnect();
    return; // daemon not running — keep polling until the next daemon spawn.
  }
  if (isDaemonSocketActive()) return;

  let thisWs: WebSocket;
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
    console.log('[opencli] Connected to daemon');
    reconnectAttempts = 0; // Reset on successful connection
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    // Send version + compatibility range so the daemon can report mismatches to the CLI
    safeSend(thisWs, {
      type: 'hello',
      contextId: currentContextId,
      version: chrome.runtime.getManifest().version,
      compatRange: __OPENCLI_COMPAT_RANGE__,
    });
    // Application-level keepalive. Chrome (116+) extends the service worker's
    // lifetime on WebSocket ACTIVITY — an idle OPEN socket does not count, so
    // without this the worker lives on a knife-edge between the 30s idle kill
    // and the 30s keepalive alarm. The daemon ignores `ping` messages.
    startWsKeepalive(thisWs);
  };

  thisWs.onmessage = async (event) => {
    if (ws !== thisWs) return;
    try {
      const command = JSON.parse(event.data as string) as Command;
      const result = await executeWithJournal(command, handleCommand);
      // The socket may have been replaced while a long command ran. Deliver
      // the result on the freshest open socket — the daemon correlates by id,
      // and the journal replays it if this delivery is lost too.
      const target = ws && ws.readyState === WebSocket.OPEN ? ws : thisWs;
      safeSend(target, result);
    } catch (err) {
      console.error('[opencli] Message handling error:', err);
    }
  };

  thisWs.onclose = () => {
    stopWsKeepalive(thisWs);
    if (ws !== thisWs) return;
    console.log('[opencli] Disconnected from daemon');
    ws = null;
    scheduleReconnect();
  };

  thisWs.onerror = () => {
    thisWs.close();
  };
}

// ─── WebSocket keepalive ─────────────────────────────────────────────

const WS_KEEPALIVE_INTERVAL_MS = 20_000;
let wsKeepaliveTimer: ReturnType<typeof setInterval> | null = null;
let wsKeepaliveSocket: WebSocket | null = null;

function startWsKeepalive(socket: WebSocket): void {
  if (wsKeepaliveTimer) clearInterval(wsKeepaliveTimer);
  wsKeepaliveSocket = socket;
  wsKeepaliveTimer = setInterval(() => {
    if (socket !== ws || socket.readyState !== WebSocket.OPEN) {
      stopWsKeepalive(socket);
      return;
    }
    safeSend(socket, { type: 'ping', ts: Date.now() });
  }, WS_KEEPALIVE_INTERVAL_MS);
}

function stopWsKeepalive(socket: WebSocket): void {
  if (wsKeepaliveSocket !== socket) return;
  if (wsKeepaliveTimer) clearInterval(wsKeepaliveTimer);
  wsKeepaliveTimer = null;
  wsKeepaliveSocket = null;
}

/**
 * Reconnect cadence: plain exponential backoff with jitter, never giving up
 * while Chrome keeps the service worker alive. 1s → 2s → 4s → … capped at 15s
 * (+0-500ms jitter); attempts reset on a successful WS open. The durable wake
 * path is chrome.alarms: production Chrome enforces a ~30s minimum alarm
 * interval, so alarms wake the worker after idle eviction while setTimeout
 * provides the faster path only when the worker remains alive.
 */
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;

function nextReconnectDelayMs(): number {
  const exp = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** Math.min(reconnectAttempts, 6));
  return exp + Math.floor(Math.random() * 500);
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  const delay = nextReconnectDelayMs();
  reconnectAttempts++;
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
  // Retained for registry/type compatibility. Adapter automation no longer
  // creates or discovers a visible tab group.
  automation: 'OpenCLI Adapter',
};
const OWNED_TAB_GROUP_COLOR: chrome.tabGroups.ColorEnum = 'orange';
let leaseMutationQueue: Promise<void> = Promise.resolve();
const ownedContainers: Record<OwnedWindowRole, {
  windowId: number | null;
  groupId: number | null;
  promise: Promise<{ windowId: number; initialTabId?: number }> | null;
  groupPromise: Promise<OwnedContainerGroup | null> | null;
}> = {
  interactive: { windowId: null, groupId: null, promise: null, groupPromise: null },
  automation: { windowId: null, groupId: null, promise: null, groupPromise: null },
};

// Ledger of every interactive group id we have created or adopted in the
// CURRENT browser session, kept so an orphan group (created by
// `chrome.tabs.group` but never titled because the worker died before the
// `tabGroups.update`) stays discoverable even when the cached `groupId` and
// lease/title layers can't see it. Interactive-only: adapter automation never
// creates a visible group. Persisted as part of the session registry (see
// StoredRegistry) and restored by reconcileTargetLeaseRegistry().
const interactiveGroupLedger = new Set<number>();

type StoredLease = Omit<TargetLease, 'idleTimer' | 'idleDeadlineAt'> & {
  idleDeadlineAt: number;
  updatedAt: number;
};

// The registry lives in chrome.storage.session, never chrome.storage.local:
// every id it carries (window, tab, group) is a Chrome runtime number that is
// only valid within one browser session. Persisting them across a browser
// restart never enabled real recovery — a recycled id could instead collide
// with a user-created window/tab/group and let the restore path claim it.
// storage.session survives MV3 service-worker restarts (the case recovery
// exists for) and is cleared exactly when the ids die. initialize() also
// best-effort removes the legacy storage.local copy older versions wrote.
// Boundary: storage.session is also cleared on extension disable/reload/update
// and on browser restart — recovery is only promised across service-worker
// restarts within one browser session. Old leases are NOT recovered after an
// extension reload/update, and no durable-id logic should be added for that.
type StoredRegistry = {
  version: 2;
  contextId: BrowserContextId;
  ownedContainers: {
    interactive: { windowId: number | null; groupIds: number[] };
    automation: { windowId: number | null };
  };
  leases: Record<string, StoredLease>;
};

class CommandFailure extends Error {
  constructor(readonly code: string, message: string, readonly hint?: string) {
    super(message);
    this.name = 'CommandFailure';
  }
}

/**
 * Per-session overrides set via command fields (idleTimeout / windowMode /
 * siteSession). One record per lease key — a single map so create/clear
 * stay in lockstep.
 */
type SessionOverrides = {
  idleTimeoutMs?: number;
  windowMode?: WindowMode;
  lifecycle?: LeaseLifecycle;
};
const sessionOverrides = new Map<string, SessionOverrides>();

function setSessionOverride(key: string, patch: SessionOverrides): void {
  sessionOverrides.set(key, { ...sessionOverrides.get(key), ...patch });
}

/** Commands currently executing per lease — idle release is deferred while > 0. */
const activeCommandCounts = new Map<string, number>();
const LEASE_KEY_SEPARATOR = '\u0000';

function getLeaseKey(session: string, surface: BrowserSurface): string {
  return `${surface}${LEASE_KEY_SEPARATOR}${encodeURIComponent(session)}`;
}

function getSessionName(session?: string): string {
  const raw = session?.trim();
  if (!raw) throw new CommandFailure(
    'session_required',
    'Browser session is required.',
    'Pass a browser session name, e.g. opencli browser <session> <command>.',
  );
  return raw;
}

function getCommandSurface(cmd: Pick<Command, 'surface' | 'session'>): BrowserSurface {
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
  const overrides = sessionOverrides.get(key);
  const adapterPersistent = getSurfaceFromKey(key) === 'adapter'
    && (session?.lifecycle === 'persistent' || overrides?.lifecycle === 'persistent');
  if (adapterPersistent) return IDLE_TIMEOUT_NONE;
  if (overrides?.idleTimeoutMs !== undefined) return overrides.idleTimeoutMs;
  return getSurfaceFromKey(key) === 'browser' ? IDLE_TIMEOUT_INTERACTIVE : IDLE_TIMEOUT_DEFAULT;
}

function getLeaseLifecycle(key: string, kind: LeaseKind): LeaseLifecycle {
  if (kind === 'bound') return 'pinned';
  const override = sessionOverrides.get(key)?.lifecycle;
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
  return sessionOverrides.get(key)?.windowMode
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
        groupIds: [...interactiveGroupLedger],
      },
      automation: { windowId: ownedContainers.automation.windowId },
    },
    leases: {},
  };
}

async function readRegistry(): Promise<StoredRegistry> {
  try {
    const session = chrome.storage?.session;
    if (!session) return emptyRegistry(); // no session storage — degrade to memory-only
    const raw = await session.get(REGISTRY_KEY) as Record<string, unknown>;
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
          groupIds: Array.isArray(storedContainers.interactive?.groupIds)
            ? storedContainers.interactive.groupIds.filter((id): id is number => typeof id === 'number')
            : [],
        },
        automation: {
          windowId: typeof storedContainers.automation?.windowId === 'number' ? storedContainers.automation.windowId : null,
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
    await chrome.storage?.session?.set({ [REGISTRY_KEY]: registry });
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
        groupIds: [...interactiveGroupLedger],
      },
      automation: { windowId: ownedContainers.automation.windowId },
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
  sessionOverrides.delete(leaseKey);
  scheduleIdleAlarm(leaseKey, IDLE_TIMEOUT_NONE);
  await persistRuntimeState();
}

// `remainingMs` lets the caller honor an already-elapsed deadline (e.g. after a
// service-worker restart) instead of granting a fresh full timeout. When given,
// the timer/alarm fire after the clamped remaining lifetime; when omitted, a
// full idle timeout is started.
function resetWindowIdleTimer(leaseKey: string, remainingMs?: number): void {
  const session = automationSessions.get(leaseKey);
  if (!session) return;
  if (session.idleTimer) clearTimeout(session.idleTimer);
  const timeout = getIdleTimeout(leaseKey);
  if (timeout <= 0) {
    scheduleIdleAlarm(leaseKey, timeout);
    session.idleTimer = null;
    session.idleDeadlineAt = 0;
    void persistRuntimeState();
    return;
  }
  const interval = remainingMs === undefined
    ? timeout
    : Math.max(0, Math.min(remainingMs, timeout));
  scheduleIdleAlarm(leaseKey, interval);
  session.idleDeadlineAt = Date.now() + interval;
  void persistRuntimeState();
  session.idleTimer = setTimeout(async () => {
    if ((activeCommandCounts.get(leaseKey) ?? 0) > 0) {
      // A command is still executing on this lease — never tear the tab down
      // from under it. Its completion re-arms the timer.
      return;
    }
    await releaseLease(leaseKey, 'idle timeout');
  }, interval);
}

function getOwnedContainerGroupTitles(role: OwnedWindowRole): string[] {
  return role === 'automation' ? [] : [CONTAINER_TAB_GROUP_TITLE.interactive];
}

type OwnedContainerGroup = {
  id: number;
  windowId: number;
  title?: string;
};

type OwnedContainerGroupCandidate = OwnedContainerGroup & {
  focused: boolean;
  hasReusableTab: boolean;
};

async function focusOwnedWindowIfRequested(windowId: number, mode: WindowMode): Promise<void> {
  if (mode !== 'foreground') return;
  const updateWindow = (chrome.windows as unknown as { update?: (windowId: number, updateInfo: { focused?: boolean }) => Promise<unknown> }).update;
  if (typeof updateWindow === 'function') await updateWindow(windowId, { focused: true }).catch(() => {});
}

async function toOwnedContainerGroupCandidate(group: chrome.tabGroups.TabGroup): Promise<OwnedContainerGroupCandidate | null> {
  try {
    const chromeWindow = await chrome.windows.get(group.windowId);
    const reusableTabId = await findReusableOwnedContainerTab(group.windowId, group.id);
    return {
      id: group.id,
      windowId: group.windowId,
      title: group.title,
      focused: !!chromeWindow.focused,
      hasReusableTab: reusableTabId !== undefined,
    };
  } catch {
    // Ignore stale browser-session group/window state and keep looking.
    return null;
  }
}

function selectOwnedContainerGroupCandidate(candidates: OwnedContainerGroupCandidate[]): OwnedContainerGroupCandidate | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    if (a.focused !== b.focused) return a.focused ? -1 : 1;
    if (a.hasReusableTab !== b.hasReusableTab) return a.hasReusableTab ? -1 : 1;
    if (a.windowId !== b.windowId) return a.windowId - b.windowId;
    return a.id - b.id;
  })[0];
}

async function collectOwnedGroupCandidates(role: OwnedWindowRole): Promise<OwnedContainerGroupCandidate[]> {
  if (role === 'automation') return [];

  const container = ownedContainers[role];
  const groupsById = new Map<number, chrome.tabGroups.TabGroup>();

  if (container.groupId !== null) {
    try {
      const group = await chrome.tabGroups.get(container.groupId);
      groupsById.set(group.id, group);
    } catch {
      container.groupId = null;
    }
  }

  // Ledger layer: every interactive group id created/adopted this browser
  // session (role is guaranteed 'interactive' past the early return above).
  // Catches the untitled orphan that all title/lease/color layers miss. A
  // missing id means the group has been closed or converged away — drop it so
  // the ledger stays bounded and never resurrects a dead id.
  let ledgerPruned = false;
  for (const groupId of [...interactiveGroupLedger]) {
    if (groupsById.has(groupId)) continue;
    try {
      const group = await chrome.tabGroups.get(groupId);
      groupsById.set(group.id, group);
    } catch {
      interactiveGroupLedger.delete(groupId);
      ledgerPruned = true;
    }
  }
  if (ledgerPruned) await persistRuntimeState();

  for (const title of getOwnedContainerGroupTitles(role)) {
    const groups = await chrome.tabGroups.query({ title });
    for (const group of groups) groupsById.set(group.id, group);
  }

  for (const [leaseKey, session] of automationSessions.entries()) {
    if (!session.owned || getOwnedWindowRole(leaseKey) !== role || session.preferredTabId === null) continue;
    try {
      const tab = await chrome.tabs.get(session.preferredTabId);
      const groupId = tab.groupId;
      if (typeof groupId !== 'number' || groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) continue;
      const group = await chrome.tabGroups.get(groupId);
      groupsById.set(group.id, group);
    } catch {
      // Lease tabs and browser-session groups can disappear independently.
    }
  }

  // 4th layer: scan every window for empty-title orphan groups left behind
  // when the worker died between `chrome.tabs.group` returning and the
  // title/color `tabGroups.update` landing. We cannot use color as a signal
  // (Chrome assigns a default palette color before our update lands), and we
  // cannot scope by `container.windowId` because the canonical group can
  // converge into the user window after cross-window moves so `windowId`
  // would miss the multi-window orphan symptom. Hijack-protected via a
  // per-role ownership-tab signal: the orphan must contain a tab that is the
  // `preferredTabId` of a still-registered owned session for this role.
  // User-built untitled groups never satisfy that condition.
  const ownedPreferredTabIds = new Set<number>();
  for (const [leaseKey, session] of automationSessions.entries()) {
    if (!session.owned || getOwnedWindowRole(leaseKey) !== role || session.preferredTabId === null) continue;
    ownedPreferredTabIds.add(session.preferredTabId);
  }
  if (ownedPreferredTabIds.size > 0) {
    try {
      const allGroups = await chrome.tabGroups.query({});
      for (const group of allGroups) {
        if (group.title) continue;
        if (groupsById.has(group.id)) continue;
        const tabsInGroup = await chrome.tabs.query({ groupId: group.id });
        if (tabsInGroup.some((tab) => tab.id !== undefined && ownedPreferredTabIds.has(tab.id))) {
          groupsById.set(group.id, group);
        }
      }
    } catch {
      // Transient query failure: convergence proceeds with the other layers.
    }
  }

  const candidates = await Promise.all([...groupsById.values()].map(toOwnedContainerGroupCandidate));
  return candidates.filter((candidate): candidate is OwnedContainerGroupCandidate => candidate !== null);
}

function updateOwnedSessionWindowForTabs(role: OwnedWindowRole, tabIds: number[], windowId: number): void {
  const moved = new Set(tabIds);
  for (const [leaseKey, session] of automationSessions.entries()) {
    if (!session.owned || getOwnedWindowRole(leaseKey) !== role) continue;
    if (session.preferredTabId !== null && moved.has(session.preferredTabId)) {
      session.windowId = windowId;
    }
  }
}

async function ensureTabsInWindow(tabIds: number[], windowId: number): Promise<number[]> {
  const movedIds: number[] = [];
  for (const tabId of tabIds) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.windowId !== windowId) {
        await chrome.tabs.move(tabId, { windowId, index: -1 });
        movedIds.push(tabId);
      }
    } catch {
      // The caller may be cleaning stale session state. Missing tabs are ignored here.
    }
  }
  return movedIds;
}

async function ensureCanonicalGroupTitle(role: OwnedWindowRole, group: OwnedContainerGroup): Promise<OwnedContainerGroup> {
  const canonicalTitle = CONTAINER_TAB_GROUP_TITLE[role];
  if (group.title === canonicalTitle) return group;
  const updated = await chrome.tabGroups.update(group.id, {
    title: canonicalTitle,
    color: OWNED_TAB_GROUP_COLOR,
  });
  return { id: updated.id, windowId: updated.windowId, title: updated.title };
}

async function convergeOwnedGroupDuplicates(
  role: OwnedWindowRole,
  canonical: OwnedContainerGroup,
  candidates: OwnedContainerGroup[],
): Promise<OwnedContainerGroup> {
  for (const duplicate of candidates) {
    if (duplicate.id === canonical.id) continue;
    const tabs = await chrome.tabs.query({ groupId: duplicate.id });
    const tabIds = tabs.map((tab) => tab.id).filter((id): id is number => id !== undefined);
    if (tabIds.length === 0) continue;
    await ensureTabsInWindow(tabIds, canonical.windowId);
    await chrome.tabs.group({ groupId: canonical.id, tabIds });
    updateOwnedSessionWindowForTabs(role, tabIds, canonical.windowId);
  }
  return canonical;
}

async function attachTabsToOwnedGroup(
  role: OwnedWindowRole,
  group: OwnedContainerGroup,
  ids: number[],
): Promise<OwnedContainerGroup> {
  if (ids.length === 0) return group;
  await ensureTabsInWindow(ids, group.windowId);
  const tabs = await Promise.all(ids.map((id) => chrome.tabs.get(id).catch(() => null)));
  const missing = tabs
    .filter((tab): tab is chrome.tabs.Tab => tab !== null && tab.id !== undefined && tab.groupId !== group.id)
    .map((tab) => tab.id!);
  if (missing.length > 0) await chrome.tabs.group({ groupId: group.id, tabIds: missing });
  updateOwnedSessionWindowForTabs(role, ids, group.windowId);
  return group;
}

async function createOwnedGroup(
  role: OwnedWindowRole,
  windowId: number,
  ids: number[],
): Promise<OwnedContainerGroup> {
  if (ids.length === 0) throw new Error(`Cannot create ${role} tab group without tabs`);
  await ensureTabsInWindow(ids, windowId);
  const groupId = await chrome.tabs.group({ tabIds: ids, createProperties: { windowId } });
  ownedContainers[role].groupId = groupId;
  ownedContainers[role].windowId = windowId;
  // Record in the ledger and persist BEFORE the title/color update lands so a
  // worker crash between the two API calls can self-heal on resume:
  // `ensureCanonicalGroupTitle` repairs the title on the next ensure cycle
  // once the ledger surfaces the untitled orphan. We must not `tabs.ungroup`
  // on failure or the recorded id dangles.
  if (role === 'interactive') interactiveGroupLedger.add(groupId);
  await persistRuntimeState();
  const group = await chrome.tabGroups.update(groupId, {
    color: OWNED_TAB_GROUP_COLOR,
    title: CONTAINER_TAB_GROUP_TITLE[role],
    collapsed: false,
  });
  updateOwnedSessionWindowForTabs(role, ids, group.windowId);
  return { id: group.id, windowId: group.windowId, title: group.title };
}

async function ensureOwnedContainerGroup(
  role: OwnedWindowRole,
  fallbackWindowId: number | null,
  tabIds: Array<number | undefined>,
): Promise<OwnedContainerGroup | null> {
  // Adapter automation runs in an owned background window but no longer creates
  // a visible "OpenCLI Adapter" tab group. Its ownership anchors are the
  // persisted container windowId and per-lease preferredTabId.
  if (role === 'automation') return null;

  const ids = [...new Set(tabIds.filter((id): id is number => id !== undefined))];

  const container = ownedContainers[role];
  const previousGroupPromise = container.groupPromise ?? Promise.resolve(null);
  const nextGroupPromise = previousGroupPromise
    .catch(() => null)
    .then(() => ensureOwnedContainerGroupUnlocked(role, fallbackWindowId, ids));
  const trackedGroupPromise = nextGroupPromise.finally(() => {
    if (container.groupPromise === trackedGroupPromise) container.groupPromise = null;
  });
  container.groupPromise = trackedGroupPromise;
  return trackedGroupPromise;
}

async function ensureOwnedContainerGroupUnlocked(
  role: OwnedWindowRole,
  fallbackWindowId: number | null,
  ids: number[],
): Promise<OwnedContainerGroup | null> {
  try {
    const candidates = await collectOwnedGroupCandidates(role);
    const selected = selectOwnedContainerGroupCandidate(candidates);
    let canonical: OwnedContainerGroup | null = selected
      ? { id: selected.id, windowId: selected.windowId, title: selected.title }
      : null;

    if (canonical) {
      canonical = await convergeOwnedGroupDuplicates(role, canonical, candidates);
      canonical = await ensureCanonicalGroupTitle(role, canonical);
      canonical = await attachTabsToOwnedGroup(role, canonical, ids);
    } else if (fallbackWindowId !== null && ids.length > 0) {
      canonical = await createOwnedGroup(role, fallbackWindowId, ids);
    }

    if (canonical) {
      ownedContainers[role].windowId = canonical.windowId;
      ownedContainers[role].groupId = canonical.id;
      // Adopt into the session ledger — covers canonicals found via the
      // title/lease layers (e.g. a legacy group) that createOwnedGroup never
      // recorded (role is 'interactive' whenever a canonical exists).
      if (!interactiveGroupLedger.has(canonical.id)) {
        interactiveGroupLedger.add(canonical.id);
        await persistRuntimeState();
      }
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
      const group = await ensureOwnedContainerGroup(role, container.windowId, []);
      if (group) {
        await focusOwnedWindowIfRequested(group.windowId, mode);
        const initialTabId = await findReusableOwnedContainerTab(group.windowId, group.id);
        return {
          windowId: group.windowId,
          initialTabId,
        };
      }
      await focusOwnedWindowIfRequested(container.windowId, mode);
      const initialTabId = await findReusableOwnedContainerTab(container.windowId, null);
      const createdGroup = await ensureOwnedContainerGroup(role, container.windowId, [initialTabId]);
      if (createdGroup) {
        return {
          windowId: createdGroup.windowId,
          initialTabId,
        };
      }
      return {
        windowId: container.windowId,
        initialTabId,
      };
    } catch {
      container.windowId = null;
      container.groupId = null;
    }
  }

  const existingGroup = await ensureOwnedContainerGroup(role, null, []);
  if (existingGroup) {
    await focusOwnedWindowIfRequested(existingGroup.windowId, mode);
    const initialTabId = await findReusableOwnedContainerTab(existingGroup.windowId, existingGroup.id);
    await persistRuntimeState();
    return {
      windowId: existingGroup.windowId,
      initialTabId,
    };
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
  // Persist windowId before any further awaits so a worker crash between
  // `windows.create` returning and the subsequent `tabs.group` call still
  // lets the next ensure cycle reuse this window instead of spawning a
  // second owned window in `chrome.windows.create`.
  await persistRuntimeState();
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
  const group = await ensureOwnedContainerGroup(role, container.windowId, [initialTabId]);
  await persistRuntimeState();
  return { windowId: group?.windowId ?? container.windowId, initialTabId };
}

async function findReusableOwnedContainerTab(windowId: number, ownedGroupId?: number | null): Promise<number | undefined> {
  try {
    const tabs = await chrome.tabs.query({ windowId });
    // When a canonical owned group lives in a user window (cross-window
    // convergence can land it there), an http(s) tab outside the group is
    // user content and must not be reused. Group members and non-http tabs
    // (about:blank / data: / fresh container) stay eligible. A null group id
    // means no ownership signal exists, so only non-http placeholders qualify.
    const reusable = tabs.find(tab =>
      tab.id !== undefined &&
      initialTabIsAvailable(tab.id) &&
      isDebuggableUrl(tab.url) &&
      (
        ownedGroupId === undefined ||
        (ownedGroupId !== null && tab.groupId === ownedGroupId) ||
        !isSafeNavigationUrl(tab.url ?? '')
      ),
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
  const tabId = tab.id;
  if (!tabId) throw new Error('Failed to create tab lease in automation container');
  const group = await ensureOwnedContainerGroup(role, windowId, [tabId]);
  const sessionWindowId = group?.windowId ?? tab.windowId;
  if (tab.windowId !== sessionWindowId) tab = await chrome.tabs.get(tabId);

  setLeaseSession(leaseKey, {
    session: getSessionFromKey(leaseKey),
    surface: getSurfaceFromKey(leaseKey),
    kind: 'owned',
    windowId: sessionWindowId,
    owned: true,
    preferredTabId: tabId,
  });
  resetWindowIdleTimer(leaseKey);
  return { tabId, tab };
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
  // A window-close event can wake the worker before recovery; persisting the
  // empty pre-recovery snapshot here would wipe the registry.
  await workerReady;
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
      sessionOverrides.delete(leaseKey);
      scheduleIdleAlarm(leaseKey, IDLE_TIMEOUT_NONE);
    }
  }
  await persistRuntimeState();
});

// Evict identity mappings when tabs are closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  // Same wake-before-recovery hazard as windows.onRemoved.
  await workerReady;
  identity.evictTab(tabId);
  for (const [leaseKey, session] of automationSessions.entries()) {
    if (session.preferredTabId === tabId) {
      if (session.idleTimer) clearTimeout(session.idleTimer);
      automationSessions.delete(leaseKey);
      sessionOverrides.delete(leaseKey);
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
  chrome.alarms.create('keepalive', { periodInMinutes: 0.5 }); // Chrome production minimum: 30 seconds
  executor.registerListeners();
  try {
    const registerFrameTracking = (executor as { registerFrameTracking?: () => void }).registerFrameTracking;
    registerFrameTracking?.();
  } catch {
    // Some focused tests mock only the cdp functions they exercise.
  }
  // Migration cleanup: older versions persisted the registry in
  // chrome.storage.local, where its browser-session-scoped ids go stale after
  // a browser restart (see StoredRegistry). Remove that one legacy key —
  // nothing else in local — so it can never be trusted again. Fire-and-forget:
  // nothing reads the local copy anymore, so ordering does not matter.
  try {
    void chrome.storage?.local?.remove?.(REGISTRY_KEY)?.catch?.(() => {});
  } catch {
    // Best-effort cleanup.
  }
  // Rehydrate context + lease/container state before any event handler that
  // persists is allowed to run (see workerReady). connect() is deliberately
  // outside this promise — it awaits workerReady on its own, so keeping it out
  // avoids a self-wait while still ordering the socket after recovery.
  workerRecovered = false;
  workerReady = (async () => {
    await getCurrentContextId();
    await reconcileTargetLeaseRegistry();
  })().catch((err) => {
    // Never leave workerReady rejected/pending: a wedged gate would freeze
    // every gated handler for the life of the worker.
    console.warn(`[opencli] Startup recovery failed: ${err instanceof Error ? err.message : String(err)}`);
  }).finally(() => {
    workerRecovered = true;
  });
  void workerReady.then(() => connect());
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
  // Idle-lease alarms and keepalive can both fire in a freshly woken worker;
  // gate on recovery so releaseLease never persists an empty snapshot.
  await workerReady;
  if (alarm.name === 'keepalive') void connect();
  const leaseKey = leaseKeyFromAlarmName(alarm.name);
  if (!leaseKey) return;
  if ((activeCommandCounts.get(leaseKey) ?? 0) > 0) {
    // A command is mid-flight (the alarm can fire while a long command runs
    // in a woken worker) — defer; command completion re-arms the idle timer.
    resetWindowIdleTimer(leaseKey);
    return;
  }
  await releaseLease(leaseKey, 'idle alarm');
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
    setSessionOverride(leaseKey, { windowMode: cmd.windowMode });
  }
  if (surface === 'adapter' && (cmd.siteSession === 'persistent' || cmd.siteSession === 'ephemeral')) {
    setSessionOverride(leaseKey, { lifecycle: cmd.siteSession });
  }
  // Apply custom idle timeout if specified in the command
  if (cmd.idleTimeout != null && cmd.idleTimeout > 0) {
    setSessionOverride(leaseKey, { idleTimeoutMs: cmd.idleTimeout * 1000 });
  }
  // Reset idle timer on every command (window stays alive while active).
  // The in-flight refcount below additionally blocks idle release while a
  // long command is still executing — otherwise a 30s idle timer could tear
  // the tab down mid-command.
  resetWindowIdleTimer(leaseKey);
  activeCommandCounts.set(leaseKey, (activeCommandCounts.get(leaseKey) ?? 0) + 1);
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
    return errorResult(cmd.id, err);
  } finally {
    const remaining = (activeCommandCounts.get(leaseKey) ?? 1) - 1;
    if (remaining <= 0) activeCommandCounts.delete(leaseKey);
    else activeCommandCounts.set(leaseKey, remaining);
    // Grant a fresh idle window measured from command COMPLETION, not start.
    resetWindowIdleTimer(leaseKey);
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

  const role = getOwnedWindowRole(leaseKey);
  const group = existingSession?.owned ? await ensureOwnedContainerGroup(role, windowId, []) : null;
  const scopedWindowId = group?.windowId ?? windowId;
  const reusableTabId = await findReusableOwnedContainerTab(scopedWindowId, existingSession?.owned ? (group?.id ?? null) : undefined);
  if (reusableTabId !== undefined) return { tabId: reusableTabId, tab: await chrome.tabs.get(reusableTabId) };

  // No debuggable tab — another extension may have hijacked the tab URL.
  // Only recycle arbitrary tabs for legacy unscoped sessions. Owned sessions
  // without a group signal must create a fresh tab rather than overwrite user
  // content in a window where an OpenCLI group may have disappeared.
  const tabs = await chrome.tabs.query({ windowId: scopedWindowId });
  const reuseTab = existingSession?.owned ? undefined : tabs.find(t => t.id);
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
  const newTab = await chrome.tabs.create({ windowId: scopedWindowId, url: BLANK_PAGE, active: true });
  if (!newTab.id) throw new Error('Failed to create tab in automation container');
  await ensureOwnedContainerGroup(role, scopedWindowId, [newTab.id]);
  return { tabId: newTab.id, tab: await chrome.tabs.get(newTab.id) };
}

/** Build a page-scoped success result with targetId resolved from tabId */
async function pageScopedResult(id: string, tabId: number, data?: unknown): Promise<Result> {
  const page = await identity.resolveTargetId(tabId);
  return { id, ok: true, data, page };
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

/**
 * Derive the per-command CDP deadline from the command's absolute deadline
 * (preferred — remaining budget absorbs service-worker wake and queueing
 * latency) or the legacy duration field. Undercut by 5s so this (more
 * specific) error reaches the CLI before the daemon's generic timer fires.
 * Returns undefined when the command carries neither — callers fall back to
 * the executor's default deadline.
 */
function commandCdpTimeoutMs(cmd: Command): number | undefined {
  if (typeof cmd.deadlineAt === 'number' && cmd.deadlineAt > 0) {
    return Math.max(10_000, cmd.deadlineAt - Date.now() - 5_000);
  }
  if (typeof cmd.timeout === 'number' && cmd.timeout > 0) {
    return Math.max(10_000, cmd.timeout * 1000 - 5_000);
  }
  return undefined;
}

/**
 * Map an executor error to a machine-readable code so the CLI can decide
 * retry safety without regex-matching message text:
 * - `attach_failed` / `tab_gone`: failed BEFORE any page code ran — a new
 *   logical attempt is safe;
 * - `target_navigated`: the document changed under the command — the page
 *   layer decides whether to settle-retry;
 * - `detached_mid_command` / `cdp_timeout`: died MID-execution — the outcome
 *   is unknown, a blind re-run could double-apply a write.
 */
function classifyExtensionError(message: string): string | undefined {
  if (/Inspected target navigated|Target closed/.test(message)) return 'target_navigated';
  if (/Detached while handling command/.test(message)) return 'detached_mid_command';
  if (/CDP command .* timed out/.test(message)) return 'cdp_timeout';
  if (/attach failed|Debugger is not attached/.test(message)) return 'attach_failed';
  if (/No tab with id|no longer exists|No window with id/.test(message)) return 'tab_gone';
  return undefined;
}

function errorResult(id: string, err: unknown): Result {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof CommandFailure) {
    return { id, ok: false, error: message, errorCode: err.code, ...(err.hint ? { errorHint: err.hint } : {}) };
  }
  const errorCode = classifyExtensionError(message);
  return { id, ok: false, error: message, ...(errorCode ? { errorCode } : {}) };
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
      const data = await executor.evaluateInFrame(tabId, cmd.code, frames[cmd.frameIndex].frameId, aggressive, commandCdpTimeoutMs(cmd));
      return pageScopedResult(cmd.id, tabId, data);
    }
    const data = await executor.evaluateAsync(tabId, cmd.code, aggressive, commandCdpTimeoutMs(cmd));
    return pageScopedResult(cmd.id, tabId, data);
  } catch (err) {
    return errorResult(cmd.id, err);
  }
}

async function handleFrames(cmd: Command, leaseKey: string): Promise<Result> {
  const cmdTabId = await resolveCommandTabId(cmd);
  const tabId = await resolveTabId(cmdTabId, leaseKey);
  try {
    const tree = await executor.getFrameTree(tabId);
    return { id: cmd.id, ok: true, data: enumerateCrossOriginFrames(tree) };
  } catch (err) {
    return errorResult(cmd.id, err);
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
      let tab = await chrome.tabs.create({ windowId, url: cmd.url ?? BLANK_PAGE, active: true });
      const tabId = tab.id;
      if (!tabId) return { id: cmd.id, ok: false, error: 'Failed to create tab' };
      const group = await ensureOwnedContainerGroup(getOwnedWindowRole(leaseKey), windowId, [tabId]);
      const sessionWindowId = group?.windowId ?? tab.windowId;
      if (tab.windowId !== sessionWindowId) tab = await chrome.tabs.get(tabId);
      setLeaseSession(leaseKey, {
        session: getSessionFromKey(leaseKey),
        surface: getSurfaceFromKey(leaseKey),
        kind: 'owned',
        windowId: sessionWindowId,
        owned: true,
        preferredTabId: tabId,
      });
      resetWindowIdleTimer(leaseKey);
      return pageScopedResult(cmd.id, tabId, { url: tab.url });
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
    return errorResult(cmd.id, err);
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
      ? await executor.sendCommandInFrameTarget(tabId, routeFrameId, cmd.cdpMethod, stripOpenCliFrameRoutingParams(params, true), aggressive, commandCdpTimeoutMs(cmd) ?? 30_000, routeTargetUrl)
      : await executor.sendDebuggerCommand(
        { tabId },
        cmd.cdpMethod,
        stripOpenCliFrameRoutingParams(params, false),
        commandCdpTimeoutMs(cmd),
      );
    return pageScopedResult(cmd.id, tabId, data);
  } catch (err) {
    return errorResult(cmd.id, err);
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
    return errorResult(cmd.id, err);
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
    return errorResult(cmd.id, err);
  }
}

async function handleNetworkCaptureStart(cmd: Command, leaseKey: string): Promise<Result> {
  const cmdTabId = await resolveCommandTabId(cmd);
  const tabId = await resolveTabId(cmdTabId, leaseKey);
  try {
    await executor.startNetworkCapture(tabId, cmd.pattern);
    return pageScopedResult(cmd.id, tabId, { started: true });
  } catch (err) {
    return errorResult(cmd.id, err);
  }
}

async function handleNetworkCaptureRead(cmd: Command, leaseKey: string): Promise<Result> {
  const cmdTabId = await resolveCommandTabId(cmd);
  const tabId = await resolveTabId(cmdTabId, leaseKey);
  try {
    const data = await executor.readNetworkCapture(tabId);
    return pageScopedResult(cmd.id, tabId, data);
  } catch (err) {
    return errorResult(cmd.id, err);
  }
}

async function handleWaitDownload(cmd: Command): Promise<Result> {
  try {
    const data = await executor.waitForDownload(cmd.pattern ?? '', cmd.timeoutMs ?? 30000);
    return { id: cmd.id, ok: true, data };
  } catch (err) {
    return errorResult(cmd.id, err);
  }
}

async function releaseLease(leaseKey: string, reason: string = 'released'): Promise<void> {
  const session = automationSessions.get(leaseKey);
  if (!session) {
    sessionOverrides.delete(leaseKey);
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
          const group = await ensureOwnedContainerGroup(getOwnedWindowRole(leaseKey), session.windowId, [tab.id ?? tabId]);
          if (group) session.windowId = group.windowId;
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
  sessionOverrides.delete(leaseKey);

  await persistRuntimeState();
}

async function reconcileTargetLeaseRegistry(): Promise<void> {
  const registry = await readRegistry();
  // Restore the orphan-group ledger (readRegistry already coerced it to a
  // clean number[]).
  interactiveGroupLedger.clear();
  for (const id of registry.ownedContainers.interactive.groupIds) interactiveGroupLedger.add(id);
  // Only windowId is restored to the container cache; the in-memory groupId
  // stays null (a fresh worker) and repopulates via the session ledger,
  // title, and lease layers during the convergence below.
  for (const role of Object.keys(ownedContainers) as OwnedWindowRole[]) {
    ownedContainers[role].windowId = registry.ownedContainers[role]?.windowId ?? null;
    const windowId = ownedContainers[role].windowId;
    if (windowId !== null) {
      try {
        await chrome.windows.get(windowId);
      } catch {
        ownedContainers[role].windowId = null;
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
        setSessionOverride(leaseKey, { lifecycle: stored.lifecycle });
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
        const group = await ensureOwnedContainerGroup(role, tab.windowId, [tabId]);
        if (group) {
          const current = automationSessions.get(leaseKey);
          if (current) current.windowId = group.windowId;
        }
      }
      const remaining = stored.idleDeadlineAt > 0 ? stored.idleDeadlineAt - Date.now() : timeout;
      if (timeout > 0) {
        if (remaining <= 0) {
          await releaseLease(leaseKey, 'reconciled idle expiry');
        } else {
          // Honor the persisted remaining lifetime — not a fresh full timeout —
          // so a lease cannot dodge idle expiry by riding repeated SW restarts.
          resetWindowIdleTimer(leaseKey, remaining);
        }
      }
    } catch {
      // Registry is semantic state, not truth. If Chrome no longer has the tab,
      // drop the lease record and never close unrelated user resources.
    }
  }

  // Converge the interactive owned group on startup: adopt/title an orphan the
  // ledger surfaces, or clear a dangling groupId when none survives. Runs even
  // with no leases so orphans left by a mid-create crash get repaired instead
  // of accumulating as untitled "OpenCLI Browser" duplicates (#2097). Best
  // effort — reconcile must still persist restored leases if this fails.
  try {
    await ensureOwnedContainerGroup('interactive', null, []);
  } catch (err) {
    console.warn(`[opencli] Startup interactive group convergence failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  await persistRuntimeState();
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
  handleBind,
  resolveTabId,
  resetWindowIdleTimer,
  handleCommand,
  getSessionName,
  getCommandSurface,
  getIdleTimeout,
  getLeaseKey,
  sessionOverrides,
  reconcileTargetLeaseRegistry,
  ensureOwnedContainerGroup,
  getInteractiveContainer: () => ({
    windowId: ownedContainers.interactive.windowId,
    groupId: ownedContainers.interactive.groupId,
    groupIds: [...interactiveGroupLedger],
  }),
  connectForTest: connect,
  scheduleReconnectForTest: () => scheduleReconnect(),
  getReconnectAttempts: () => reconnectAttempts,
  setReconnectAttempts: (value: number) => { reconnectAttempts = value; },
  nextReconnectDelayMs,
  resetReconnectState: () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    reconnectAttempts = 0;
    if (wsKeepaliveTimer) clearInterval(wsKeepaliveTimer);
    wsKeepaliveTimer = null;
    wsKeepaliveSocket = null;
    connectInFlight = null;
    ws = null;
  },
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
