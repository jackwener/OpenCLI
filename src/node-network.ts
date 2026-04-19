import { Agent, EnvHttpProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici';

const LOOPBACK_NO_PROXY_ENTRIES = ['127.0.0.1', 'localhost', '::1'];

type ProxyEnvKey =
  | 'http_proxy'
  | 'https_proxy'
  | 'all_proxy'
  | 'HTTP_PROXY'
  | 'HTTPS_PROXY'
  | 'ALL_PROXY';

const PROXY_ENV_BY_PROTOCOL: Record<'http:' | 'https:', ProxyEnvKey[]> = {
  'http:': ['http_proxy', 'HTTP_PROXY', 'all_proxy', 'ALL_PROXY'],
  'https:': ['https_proxy', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY'],
};
const DEFAULT_PORT_BY_PROTOCOL: Record<'http:' | 'https:', string> = {
  'http:': '80',
  'https:': '443',
};

export interface ProxyDecision {
  mode: 'direct' | 'proxy';
  proxyUrl?: string;
}

interface NoProxyEntry {
  host: string;
  port?: string;
}

interface ProxyConfig {
  httpProxy?: string;
  httpsProxy?: string;
  noProxy?: string;
  noProxyEntries: NoProxyEntry[];
}

let installed = false;
const directDispatcher = new Agent();
const proxyDispatcherCache = new Map<string, Dispatcher>();
const nativeFetch = globalThis.fetch
  ? globalThis.fetch.bind(globalThis)
  : (input, init) => undiciFetch(input, init);

function readEnv(env: NodeJS.ProcessEnv, lower: string, upper: string): string | undefined {
  const lowerValue = env[lower];
  if (typeof lowerValue === 'string' && lowerValue.trim() !== '') return lowerValue;
  const upperValue = env[upper];
  if (typeof upperValue === 'string' && upperValue.trim() !== '') return upperValue;
  return undefined;
}

function readProxyEnv(env: NodeJS.ProcessEnv, keys: ProxyEnvKey[]): string | undefined {
  for (const key of keys) {
    const value = env[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return undefined;
}

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[(.*)\]$/, '$1').toLowerCase();
}

function splitNoProxy(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function parseNoProxyEntry(entry: string): NoProxyEntry {
  if (entry === '*') return { host: '*' };

  const trimmed = entry.trim().replace(/^\*?\./, '');
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    if (end !== -1) {
      const host = trimmed.slice(1, end);
      const rest = trimmed.slice(end + 1);
      if (rest.startsWith(':')) return { host: normalizeHostname(host), port: rest.slice(1) };
      return { host: normalizeHostname(host) };
    }
  }

  const colonCount = (trimmed.match(/:/g) ?? []).length;
  if (colonCount === 1) {
    const [host, port] = trimmed.split(':');
    return { host: normalizeHostname(host), port };
  }

  return { host: normalizeHostname(trimmed) };
}

function effectiveNoProxyEntries(env: NodeJS.ProcessEnv): NoProxyEntry[] {
  const raw = readEnv(env, 'no_proxy', 'NO_PROXY');
  const entries = splitNoProxy(raw).map(parseNoProxyEntry);
  const seen = new Set(entries.map((entry) => `${entry.host}:${entry.port ?? ''}`));
  for (const rawEntry of LOOPBACK_NO_PROXY_ENTRIES) {
    const entry = parseNoProxyEntry(rawEntry);
    const key = `${entry.host}:${entry.port ?? ''}`;
    if (seen.has(key)) continue;
    entries.push(entry);
    seen.add(key);
  }
  return entries;
}

function serializeNoProxyEntry(entry: NoProxyEntry): string {
  if (entry.host === '*') return '*';

  const host = entry.host.includes(':') ? `[${entry.host}]` : entry.host;
  return entry.port ? `${host}:${entry.port}` : host;
}

function effectiveNoProxyValue(entries: NoProxyEntry[]): string | undefined {
  if (entries.length === 0) return undefined;

  return entries.map(serializeNoProxyEntry).join(',');
}

function matchesNoProxyEntry(url: URL, entry: NoProxyEntry): boolean {
  const { host, port } = entry;
  if (host === '*') return true;

  const hostname = normalizeHostname(url.hostname);
  const urlPort = url.port || DEFAULT_PORT_BY_PROTOCOL[url.protocol as 'http:' | 'https:'] || undefined;
  if (port && port !== urlPort) return false;
  return hostname === host || hostname.endsWith(`.${host}`);
}

function resolveProxyConfig(env: NodeJS.ProcessEnv = process.env): ProxyConfig {
  const noProxyEntries = effectiveNoProxyEntries(env);
  return {
    httpProxy: readProxyEnv(env, PROXY_ENV_BY_PROTOCOL['http:']),
    httpsProxy: readProxyEnv(env, [
      'https_proxy',
      'HTTPS_PROXY',
      'http_proxy',
      'HTTP_PROXY',
      'all_proxy',
      'ALL_PROXY',
    ]),
    noProxy: effectiveNoProxyValue(noProxyEntries),
    noProxyEntries,
  };
}

function createProxyDispatcher(config: ProxyConfig): Dispatcher {
  const cacheKey = JSON.stringify([
    config.httpProxy ?? '',
    config.httpsProxy ?? '',
    config.noProxy ?? '',
  ]);
  const cached = proxyDispatcherCache.get(cacheKey);
  if (cached) return cached;
  const dispatcher = new EnvHttpProxyAgent({
    httpProxy: config.httpProxy,
    httpsProxy: config.httpsProxy,
    noProxy: config.noProxy,
  });
  proxyDispatcherCache.set(cacheKey, dispatcher);
  return dispatcher;
}

function resolveUrl(input: RequestInfo | URL): URL | null {
  if (typeof input === 'string') return new URL(input);
  if (input instanceof URL) return input;
  if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url);
  return null;
}

export function hasProxyEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  const config = resolveProxyConfig(env);
  return Boolean(config.httpProxy || config.httpsProxy);
}

export function decideProxy(url: URL, env: NodeJS.ProcessEnv = process.env): ProxyDecision {
  const config = resolveProxyConfig(env);
  if (config.noProxyEntries.some((entry) => matchesNoProxyEntry(url, entry))) {
    return { mode: 'direct' };
  }

  const proxyUrl = url.protocol === 'https:' ? config.httpsProxy : config.httpProxy;
  if (!proxyUrl) return { mode: 'direct' };
  return { mode: 'proxy', proxyUrl };
}

export function getDispatcherForUrl(url: URL, env: NodeJS.ProcessEnv = process.env): Dispatcher {
  const config = resolveProxyConfig(env);
  if (!config.httpProxy && !config.httpsProxy) return directDispatcher;
  return createProxyDispatcher(config);
}

export async function fetchWithNodeNetwork(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = resolveUrl(input);
  if (!url || !hasProxyEnv()) {
    return nativeFetch(input, init);
  }

  return (await undiciFetch(input as Parameters<typeof undiciFetch>[0], {
    ...init,
    dispatcher: getDispatcherForUrl(url),
  } as Parameters<typeof undiciFetch>[1])) as unknown as Response;
}

export function installNodeNetwork(): void {
  if (installed) return;

  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => (
    fetchWithNodeNetwork(input, init)
  )) as typeof globalThis.fetch;
  installed = true;
}
