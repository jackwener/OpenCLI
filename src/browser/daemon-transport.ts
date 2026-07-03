import { DEFAULT_DAEMON_PORT, isIgnorableDaemonPortEnv, unsupportedDaemonPortEnvMessage } from '../constants.js';

const DAEMON_PORT = DEFAULT_DAEMON_PORT;
const DAEMON_URL = `http://127.0.0.1:${DAEMON_PORT}`;
const OPENCLI_HEADERS = { 'X-OpenCLI': '1' };

class UnsupportedDaemonPortEnvError extends Error {
  constructor(value: string) {
    super(unsupportedDaemonPortEnvMessage(value));
    this.name = 'UnsupportedDaemonPortEnvError';
  }
}

function assertSupportedDaemonPortEnv(): void {
  const value = process.env.OPENCLI_DAEMON_PORT;
  if (!isIgnorableDaemonPortEnv(value)) throw new UnsupportedDaemonPortEnvError(value!);
}

export interface DaemonStatus {
  ok: boolean;
  pid: number;
  uptime: number;
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
  port: number;
}

export interface BrowserProfileStatus {
  contextId: string;
  extensionConnected: boolean;
  extensionVersion?: string;
  extensionCompatRange?: string;
  pending: number;
  lastSeenAt?: number;
}

export type DaemonHealth =
  | { state: 'stopped'; status: null }
  | { state: 'no-extension'; status: DaemonStatus }
  | { state: 'profile-required'; status: DaemonStatus }
  | { state: 'profile-disconnected'; status: DaemonStatus }
  | { state: 'ready'; status: DaemonStatus };

export async function requestDaemon(pathname: string, init?: RequestInit & { timeout?: number }): Promise<Response> {
  assertSupportedDaemonPortEnv();
  const { timeout = 2000, headers, ...rest } = init ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(`${DAEMON_URL}${pathname}`, {
      ...rest,
      headers: { ...OPENCLI_HEADERS, ...headers },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchDaemonStatus(opts?: { timeout?: number; contextId?: string }): Promise<DaemonStatus | null> {
  try {
    const params = opts?.contextId ? `?contextId=${encodeURIComponent(opts.contextId)}` : '';
    const res = await requestDaemon(`/status${params}`, { timeout: opts?.timeout ?? 2000 });
    if (!res.ok) return null;
    return await res.json() as DaemonStatus;
  } catch (err) {
    if (err instanceof UnsupportedDaemonPortEnvError) throw err;
    return null;
  }
}

export async function getDaemonHealth(opts?: { timeout?: number; contextId?: string }): Promise<DaemonHealth> {
  const status = await fetchDaemonStatus(opts);
  if (!status) return { state: 'stopped', status: null };
  if (status.profileRequired) return { state: 'profile-required', status };
  if (status.profileDisconnected) return { state: 'profile-disconnected', status };
  if (!status.extensionConnected) return { state: 'no-extension', status };
  return { state: 'ready', status };
}

export async function requestDaemonShutdown(opts?: { timeout?: number }): Promise<boolean> {
  try {
    const res = await requestDaemon('/shutdown', { method: 'POST', timeout: opts?.timeout ?? 5000 });
    return res.ok;
  } catch (err) {
    if (err instanceof UnsupportedDaemonPortEnvError) throw err;
    return false;
  }
}
