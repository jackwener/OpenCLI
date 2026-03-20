import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

export type BrowserLaunchMode = 'background' | 'foreground';
export type BrowserUserDataKind = 'temporary' | 'persistent' | 'unknown';
export type DebugBrowserSource = 'opencli' | 'discovered';
export type DebugBrowserStatus = 'alive' | 'stale';

export interface BrowserLaunchRegistryEntry {
  id: string;
  pid: number;
  port: number;
  endpoint: string;
  profileName?: string;
  userDataDir: string;
  userDataKind: BrowserUserDataKind;
  launchMode: BrowserLaunchMode;
  browserName?: string;
  webSocketDebuggerUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DebugBrowserInstance {
  id?: string;
  pid?: number;
  port: number;
  endpoint: string;
  profileName?: string;
  browserName?: string;
  webSocketDebuggerUrl?: string;
  userDataDir?: string;
  userDataKind: BrowserUserDataKind;
  launchMode: BrowserLaunchMode | 'unknown';
  source: DebugBrowserSource;
  status: DebugBrowserStatus;
}

export interface PortRange {
  start: number;
  end: number;
}

const DEFAULT_RANGE: PortRange = { start: 9222, end: 9350 };

function browserLaunchRoot(): string {
  return path.join(os.homedir(), '.opencli', 'browser-launch');
}

function registryPath(): string {
  return path.join(browserLaunchRoot(), 'instances.json');
}

export function temporaryBrowserLaunchRoot(): string {
  return path.join(os.tmpdir(), 'opencli-browser-launch');
}

function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port > 0 && port <= 65535;
}

function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function uniqueSortedPorts(ports: number[]): number[] {
  return [...new Set(ports.filter(isValidPort))].sort((a, b) => a - b);
}

function statusOrder(status: DebugBrowserStatus): number {
  return status === 'alive' ? 0 : 1;
}

function sourceOrder(source: DebugBrowserSource): number {
  return source === 'opencli' ? 0 : 1;
}

export function defaultDebugPortRange(): PortRange {
  return { ...DEFAULT_RANGE };
}

export function parsePortRange(raw?: string): PortRange {
  if (!raw) return defaultDebugPortRange();
  const match = raw.trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) throw new Error(`Invalid range: ${raw}. Expected format: 9222-9350`);
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!isValidPort(start) || !isValidPort(end) || start > end) {
    throw new Error(`Invalid range: ${raw}. Expected start <= end and both ports valid.`);
  }
  return { start, end };
}

export function parsePortList(raw?: string): number[] {
  if (!raw?.trim()) return [];
  const ports = raw.split(',').map((part) => Number(part.trim()));
  if (ports.some((port) => !isValidPort(port))) {
    throw new Error(`Invalid ports: ${raw}. Expected a comma-separated list like 9222,9339`);
  }
  return uniqueSortedPorts(ports);
}

export function defaultTemporaryUserDataDir(port: number, seed?: string): string {
  const suffix = seed ?? `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  return path.join(temporaryBrowserLaunchRoot(), `port-${port}-${suffix}`);
}

export function inferUserDataKind(userDataDir?: string): BrowserUserDataKind {
  if (!userDataDir) return 'unknown';
  const resolved = path.resolve(userDataDir);
  const tempRoot = path.resolve(temporaryBrowserLaunchRoot());
  if (resolved === tempRoot || resolved.startsWith(`${tempRoot}${path.sep}`)) {
    return 'temporary';
  }
  return 'persistent';
}

function expandPortRange(range: PortRange): number[] {
  const ports: number[] = [];
  for (let port = range.start; port <= range.end; port++) {
    ports.push(port);
  }
  return ports;
}

function normalizeRegistryEntry(raw: any): BrowserLaunchRegistryEntry {
  return {
    id: String(raw.id ?? `port-${raw.port}`),
    pid: Number(raw.pid ?? -1),
    port: Number(raw.port),
    endpoint: String(raw.endpoint ?? `http://127.0.0.1:${raw.port}`),
    profileName: raw.profileName ? String(raw.profileName) : undefined,
    userDataDir: String(raw.userDataDir ?? ''),
    userDataKind: raw.userDataKind ?? inferUserDataKind(raw.userDataDir),
    launchMode: raw.launchMode === 'foreground' ? 'foreground' : 'background',
    browserName: raw.browserName ? String(raw.browserName) : undefined,
    webSocketDebuggerUrl: raw.webSocketDebuggerUrl ? String(raw.webSocketDebuggerUrl) : undefined,
    createdAt: String(raw.createdAt ?? new Date(0).toISOString()),
    updatedAt: String(raw.updatedAt ?? new Date(0).toISOString()),
  };
}

function registryEntryToInstance(entry: BrowserLaunchRegistryEntry, status: DebugBrowserStatus): DebugBrowserInstance {
  return {
    id: entry.id,
    pid: entry.pid,
    port: entry.port,
    endpoint: entry.endpoint,
    profileName: entry.profileName,
    browserName: entry.browserName,
    webSocketDebuggerUrl: entry.webSocketDebuggerUrl,
    userDataDir: entry.userDataDir,
    userDataKind: entry.userDataKind,
    launchMode: entry.launchMode,
    source: 'opencli',
    status,
  };
}

function mergeInstances(
  registryInstances: DebugBrowserInstance[],
  discoveredEntries: DebugBrowserInstance[],
): DebugBrowserInstance[] {
  const merged = [...registryInstances];

  for (const discovered of discoveredEntries) {
    const existingIndex = merged.findIndex((entry) => entry.source === 'opencli' && entry.status === 'alive' && entry.port === discovered.port);
    if (existingIndex !== -1) {
      merged[existingIndex] = {
        ...merged[existingIndex],
        browserName: discovered.browserName ?? merged[existingIndex].browserName,
        webSocketDebuggerUrl: discovered.webSocketDebuggerUrl ?? merged[existingIndex].webSocketDebuggerUrl,
        status: 'alive',
      };
      continue;
    }
    merged.push(discovered);
  }

  return merged.sort((a, b) => {
    if (a.port !== b.port) return a.port - b.port;
    if (a.status !== b.status) return statusOrder(a.status) - statusOrder(b.status);
    return sourceOrder(a.source) - sourceOrder(b.source);
  });
}

export async function readLaunchRegistry(): Promise<BrowserLaunchRegistryEntry[]> {
  try {
    const raw = await fs.promises.readFile(registryPath(), 'utf-8');
    const data = safeJsonParse<any[]>(raw, []);
    return Array.isArray(data) ? data.map(normalizeRegistryEntry) : [];
  } catch (err: any) {
    if (err?.code === 'ENOENT') return [];
    throw err;
  }
}

async function writeLaunchRegistry(entries: BrowserLaunchRegistryEntry[]): Promise<void> {
  await fs.promises.mkdir(browserLaunchRoot(), { recursive: true });
  await fs.promises.writeFile(registryPath(), `${JSON.stringify(entries, null, 2)}\n`, 'utf-8');
}

export async function registerLaunchedBrowser(
  entry: Omit<BrowserLaunchRegistryEntry, 'id' | 'createdAt' | 'updatedAt' | 'userDataKind'> & { id?: string; userDataKind?: BrowserUserDataKind },
): Promise<BrowserLaunchRegistryEntry> {
  const entries = await readLaunchRegistry();
  const now = new Date().toISOString();
  const record: BrowserLaunchRegistryEntry = {
    id: entry.id ?? `port-${entry.port}`,
    createdAt: now,
    updatedAt: now,
    userDataKind: entry.userDataKind ?? inferUserDataKind(entry.userDataDir),
    ...entry,
  };
  const next = entries.filter((item) => item.id !== record.id && item.port !== record.port);
  next.push(record);
  await writeLaunchRegistry(next.sort((a, b) => a.port - b.port));
  return record;
}

export async function unregisterLaunchedBrowser(idOrPort: string | number): Promise<void> {
  const entries = await readLaunchRegistry();
  const next = entries.filter((item) => item.id !== idOrPort && item.port !== Number(idOrPort));
  if (next.length !== entries.length) {
    await writeLaunchRegistry(next);
  }
}

export async function removeLaunchRegistryEntries(predicate: (entry: BrowserLaunchRegistryEntry) => boolean): Promise<number> {
  const entries = await readLaunchRegistry();
  const next = entries.filter((entry) => !predicate(entry));
  if (next.length !== entries.length) {
    await writeLaunchRegistry(next);
  }
  return entries.length - next.length;
}

export function isProcessAlive(pid?: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === 'EPERM';
  }
}

async function isTcpPortOpen(port: number, host: string = '127.0.0.1', timeoutMs: number = 200): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

async function fetchCdpVersion(endpoint: string, timeoutMs: number = 600): Promise<any | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${endpoint.replace(/\/$/, '')}/json/version`, { signal: controller.signal });
    if (!res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function probeDebugBrowserPort(port: number, host: string = '127.0.0.1'): Promise<DebugBrowserInstance | undefined> {
  if (!(await isTcpPortOpen(port, host))) return undefined;
  const endpoint = `http://${host}:${port}`;
  const info = await fetchCdpVersion(endpoint);
  if (!info?.webSocketDebuggerUrl) return undefined;

  return {
    port,
    endpoint,
    browserName: info.Browser,
    webSocketDebuggerUrl: info.webSocketDebuggerUrl,
    userDataKind: 'unknown',
    launchMode: 'unknown',
    source: 'discovered',
    status: 'alive',
  };
}

async function listRegisteredBrowserInstances(): Promise<DebugBrowserInstance[]> {
  const entries = await readLaunchRegistry();
  const nextEntries: BrowserLaunchRegistryEntry[] = [];
  const instances: DebugBrowserInstance[] = [];

  for (const entry of entries) {
    const info = await fetchCdpVersion(entry.endpoint);
    const alive = Boolean(info?.webSocketDebuggerUrl) || isProcessAlive(entry.pid);
    const updatedEntry: BrowserLaunchRegistryEntry = {
      ...entry,
      browserName: info?.Browser ?? entry.browserName,
      webSocketDebuggerUrl: info?.webSocketDebuggerUrl ?? entry.webSocketDebuggerUrl,
      updatedAt: alive ? new Date().toISOString() : entry.updatedAt,
    };
    nextEntries.push(updatedEntry);
    instances.push(registryEntryToInstance(updatedEntry, alive ? 'alive' : 'stale'));
  }

  if (entries.length > 0) {
    await writeLaunchRegistry(nextEntries);
  }

  return instances;
}

export async function listDebugBrowsers(opts: {
  ports?: number[];
  range?: PortRange;
  host?: string;
} = {}): Promise<DebugBrowserInstance[]> {
  const host = opts.host ?? '127.0.0.1';
  const registryInstances = await listRegisteredBrowserInstances();
  const rangePorts = expandPortRange(opts.range ?? defaultDebugPortRange());
  const registryPorts = registryInstances.map((entry) => entry.port);
  const targetPorts = uniqueSortedPorts([...(opts.ports ?? []), ...registryPorts, ...rangePorts]);

  const discovered = (await Promise.all(targetPorts.map((port) => probeDebugBrowserPort(port, host))))
    .filter((entry): entry is DebugBrowserInstance => Boolean(entry));

  return mergeInstances(registryInstances, discovered);
}

export function summarizeDebugBrowsers(instances: DebugBrowserInstance[]): string {
  const active = instances.filter((entry) => entry.status === 'alive');
  const stale = instances.filter((entry) => entry.status === 'stale' && entry.source === 'opencli');

  if (active.length === 0 && stale.length === 0) return 'none discovered';

  const parts: string[] = [];
  if (active.length > 0) {
    const ports = [...new Set(active.map((entry) => entry.port))].join(', ');
    parts.push(`${active.length} active (${ports})`);
  }
  if (stale.length > 0) {
    parts.push(`${stale.length} stale`);
  }
  return parts.join(', ');
}
