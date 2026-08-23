/**
 * CLI view of native hosts: live host.json files + optional unix RPC.
 */

import { resolveProfileRoute } from '../daemon-utils.js';
import { listLiveHostStates, type HostState } from '../host-protocol.js';
import { requestHost } from './host-rpc.js';

export interface BrowserProfileStatus {
  contextId: string;
  extensionConnected: boolean;
  extensionVersion?: string;
  extensionCompatRange?: string;
  pending: number;
  lastSeenAt?: number;
}

export interface DaemonStatus {
  ok: boolean;
  pid: number;
  uptime: number;
  hostVersion?: string;
  /** @deprecated same as hostVersion; kept for status JSON readers */
  daemonVersion?: string;
  extensionConnected: boolean;
  extensionVersion?: string;
  extensionCompatRange?: string;
  contextId?: string;
  profileRequired?: boolean;
  profileDisconnected?: boolean;
  profiles?: BrowserProfileStatus[];
  pending: number;
  commandResultUnknown?: number;
  memoryMB: number;
  sock?: string;
}

export type DaemonHealth =
  | { state: 'stopped'; status: null }
  | { state: 'no-extension'; status: DaemonStatus }
  | { state: 'profile-required'; status: DaemonStatus }
  | { state: 'profile-disconnected'; status: DaemonStatus }
  | { state: 'ready'; status: DaemonStatus };

function statusFromStates(live: HostState[], routeContextId?: string): DaemonStatus {
  const chosen = routeContextId ? live.find((h) => h.contextId === routeContextId) : live[0];
  return {
    ok: true,
    pid: chosen?.pid ?? 0,
    uptime: chosen ? Math.max(0, (Date.now() - chosen.startedAt) / 1000) : 0,
    hostVersion: chosen?.hostVersion,
    daemonVersion: chosen?.hostVersion,
    extensionConnected: Boolean(chosen),
    extensionVersion: chosen?.extensionVersion ?? undefined,
    extensionCompatRange: chosen?.extensionCompatRange ?? undefined,
    contextId: chosen?.contextId ?? routeContextId,
    profiles: live.map((h) => ({
      contextId: h.contextId,
      extensionConnected: true,
      extensionVersion: h.extensionVersion ?? undefined,
      extensionCompatRange: h.extensionCompatRange ?? undefined,
      pending: 0,
      lastSeenAt: h.startedAt,
    })),
    pending: 0,
    memoryMB: 0,
    sock: chosen?.sock,
  };
}

export async function fetchDaemonStatus(opts?: {
  timeout?: number;
  contextId?: string;
  preferredContextId?: string;
}): Promise<DaemonStatus | null> {
  const live = listLiveHostStates();
  if (live.length === 0) return null;
  const route = resolveProfileRoute({
    requestedContextId: opts?.contextId,
    preferredContextId: opts?.preferredContextId,
    connectedContextIds: live.map((h) => h.contextId),
  });
  const base = statusFromStates(live, route.ok ? route.contextId : opts?.contextId);
  if (!route.ok) {
    return {
      ...base,
      extensionConnected: false,
      profileRequired: route.errorCode === 'profile_required',
      profileDisconnected: route.errorCode === 'profile_disconnected',
    };
  }
  const chosen = live.find((h) => h.contextId === route.contextId);
  if (!chosen) return { ...base, extensionConnected: false, profileDisconnected: true };
  try {
    const raw = await requestHost(chosen.sock, { id: 'status', action: 'host-status' }, { timeout: opts?.timeout ?? 2000 });
    return {
      ok: raw.ok === true,
      pid: typeof raw.pid === 'number' ? raw.pid : chosen.pid,
      uptime: typeof raw.uptime === 'number' ? raw.uptime : base.uptime,
      hostVersion: typeof raw.hostVersion === 'string' ? raw.hostVersion : chosen.hostVersion,
      daemonVersion: typeof raw.hostVersion === 'string' ? raw.hostVersion : chosen.hostVersion,
      extensionConnected: raw.extensionConnected === true,
      extensionVersion: typeof raw.extensionVersion === 'string' ? raw.extensionVersion : chosen.extensionVersion ?? undefined,
      extensionCompatRange: typeof raw.extensionCompatRange === 'string' ? raw.extensionCompatRange : undefined,
      contextId: typeof raw.contextId === 'string' ? raw.contextId : chosen.contextId,
      profiles: Array.isArray(raw.profiles) ? raw.profiles as BrowserProfileStatus[] : base.profiles,
      pending: typeof raw.pending === 'number' ? raw.pending : 0,
      commandResultUnknown: typeof raw.commandResultUnknown === 'number' ? raw.commandResultUnknown : 0,
      memoryMB: typeof raw.memoryMB === 'number' ? raw.memoryMB : 0,
      sock: chosen.sock,
    };
  } catch {
    return base;
  }
}

export async function getDaemonHealth(opts?: {
  timeout?: number;
  contextId?: string;
  preferredContextId?: string;
}): Promise<DaemonHealth> {
  const live = listLiveHostStates();
  if (live.length === 0) return { state: 'stopped', status: null };
  const status = await fetchDaemonStatus(opts);
  if (!status) return { state: 'stopped', status: null };
  if (status.profileRequired) return { state: 'profile-required', status };
  if (status.profileDisconnected) return { state: 'profile-disconnected', status };
  if (!status.extensionConnected) return { state: 'no-extension', status };
  return { state: 'ready', status };
}

export async function requestDaemonShutdown(_opts?: { timeout?: number }): Promise<boolean> {
  // Chrome owns the host process. CLI cannot shut it down without killing
  // Chrome's native port. Reload the extension instead.
  return false;
}
