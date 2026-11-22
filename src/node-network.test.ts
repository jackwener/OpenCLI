import dns from 'node:dns';
import { createServer, type Server } from 'node:http';
import { createServer as createTcpServer, type AddressInfo } from 'node:net';
import { fetch as undiciFetch, type Dispatcher } from 'undici';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fetchWithNodeNetwork, getNetworkDispatcher } from './node-network.js';

const envKeys = ['http_proxy', 'HTTP_PROXY', 'https_proxy', 'HTTPS_PROXY', 'all_proxy', 'ALL_PROXY', 'no_proxy', 'NO_PROXY'];
const connections: string[] = [];
const lookups: string[] = [];
const dispatchers = new Set<Dispatcher>();
const servers: Server[] = [];
let first: string;
let second: string;
let originPort: number;

async function listen(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '::', () => resolve());
  });
  return (server.address() as AddressInfo).port;
}

async function proxy(name: string): Promise<string> {
  const server = createServer();
  server.on('connect', (request, socket) => {
    connections.push(`${name}:${request.url}`);
    socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
  });
  return `http://127.0.0.1:${await listen(server)}`;
}

function configure(env: NodeJS.ProcessEnv): void {
  for (const key of envKeys) vi.stubEnv(key, env[key] ?? '');
  connections.length = 0;
  lookups.length = 0;
}

function assertRoute(url: string, expected: 'first' | 'second' | 'direct'): void {
  const target = new URL(url);
  if (expected === 'direct') {
    expect(connections).toEqual([]);
    expect(lookups).toContain(target.hostname);
  } else {
    expect(connections).toEqual([`${expected}:${target.hostname}:${target.port || (target.protocol === 'https:' ? '443' : '80')}`]);
    expect(lookups).toEqual([]);
  }
}

async function probeWithProcessEnv(
  url: string,
  env: NodeJS.ProcessEnv,
  expected: 'first' | 'second' | 'direct',
): Promise<void> {
  configure(env);
  dispatchers.add(getNetworkDispatcher());
  await expect(fetchWithNodeNetwork(url, { signal: AbortSignal.timeout(2000) })).rejects.toThrow();
  assertRoute(url, expected);
}

async function probeWithInjectedEnv(
  url: string,
  env: NodeJS.ProcessEnv,
  expected: 'first' | 'second' | 'direct',
): Promise<void> {
  connections.length = 0;
  lookups.length = 0;
  const dispatcher = getNetworkDispatcher(env);
  dispatchers.add(dispatcher);
  await expect(undiciFetch(url, {
    dispatcher,
    signal: AbortSignal.timeout(2000),
  })).rejects.toThrow();
  assertRoute(url, expected);
}

beforeAll(async () => {
  first = await proxy('first');
  second = await proxy('second');
  originPort = await listen(createServer((_request, response) => response.end('origin')));
  const originalLookup = dns.lookup;
  vi.spyOn(dns, 'lookup').mockImplementation(((...args: unknown[]) => {
    const hostname = String(args[0]);
    if (hostname.endsWith('.opencli.test')) {
      lookups.push(hostname);
      const callback = args.at(-1) as (error: Error) => void;
      queueMicrotask(() => callback(Object.assign(new Error('Fixture DNS rejection'), { code: 'ENOTFOUND' })));
      return;
    }
    return Reflect.apply(originalLookup, dns, args);
  }) as typeof dns.lookup);
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  await Promise.all([...dispatchers].map(dispatcher => dispatcher.destroy()));
  await Promise.all(servers.map(server => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
  vi.restoreAllMocks();
});

describe('production node network routing', () => {
  it('uses protocol-specific proxies and HTTP/ALL_PROXY fallbacks', async () => {
    await probeWithProcessEnv('http://api.opencli.test', { HTTP_PROXY: first, HTTPS_PROXY: second }, 'first');
    await probeWithProcessEnv('https://api.opencli.test', { HTTP_PROXY: first, HTTPS_PROXY: second }, 'second');
    await probeWithProcessEnv('https://api.opencli.test', { HTTP_PROXY: first }, 'first');
    for (const protocol of ['http', 'https']) {
      await probeWithProcessEnv(`${protocol}://api.opencli.test`, { ALL_PROXY: second }, 'second');
    }
  });

  it('fetches IPv4, hostname and IPv6 loopback origins without a proxy', async () => {
    configure({ HTTP_PROXY: first, HTTPS_PROXY: first });
    dispatchers.add(getNetworkDispatcher());
    for (const host of ['127.0.0.1', 'localhost', '[::1]']) {
      const response = await fetchWithNodeNetwork(`http://${host}:${originPort}`, { signal: AbortSignal.timeout(2000) });
      expect(await response.text()).toBe('origin');
    }
    expect(connections).toEqual([]);
  });

  it('honors NO_PROXY domains, default ports and global wildcard in actual requests', async () => {
    for (const entry of ['api.opencli.test', '.opencli.test', '*.opencli.test', 'api.opencli.test:443', '*']) {
      await probeWithProcessEnv('https://api.opencli.test', { HTTPS_PROXY: first, NO_PROXY: entry }, 'direct');
    }
    await probeWithProcessEnv('http://api.opencli.test', { HTTP_PROXY: first, NO_PROXY: 'api.opencli.test:80' }, 'direct');
    for (const entry of ['api.opencli.test:80', 'other.opencli.test', 'notopencli.test']) {
      await probeWithProcessEnv('https://api.opencli.test', { HTTPS_PROXY: first, NO_PROXY: entry }, 'first');
    }
  });

  it('prefers lowercase injected variables in actual proxy requests', async () => {
    await probeWithInjectedEnv('https://api.opencli.test', {
      https_proxy: second,
      HTTPS_PROXY: first,
    }, 'second');
    await probeWithInjectedEnv('https://api.opencli.test', {
      https_proxy: first,
      HTTPS_PROXY: second,
    }, 'first');
    await probeWithInjectedEnv('https://api.opencli.test', {
      HTTPS_PROXY: first,
      no_proxy: 'api.opencli.test',
      NO_PROXY: 'other.opencli.test',
    }, 'direct');
  });

  it('refreshes dispatchers for ProcessEnv changes and handles direct routes', async () => {
    const url = 'https://api.opencli.test';
    await probeWithProcessEnv(url, { HTTPS_PROXY: first }, 'first');
    await probeWithProcessEnv(url, { HTTPS_PROXY: second }, 'second');
    await probeWithProcessEnv(url, { HTTPS_PROXY: first, NO_PROXY: 'api.opencli.test' }, 'direct');
    await probeWithProcessEnv('http://api.opencli.test', {}, 'direct');
  });

  it('routes ALL_PROXY through an actual SOCKS5 handshake', async () => {
    const greetings: Buffer[] = [];
    const socks = createTcpServer(socket => socket.once('data', data => {
      greetings.push(Buffer.from(data));
      socket.end(Buffer.from([5, 255]));
    }));
    await new Promise<void>(resolve => socks.listen(0, '127.0.0.1', resolve));
    try {
      configure({ ALL_PROXY: `socks5://127.0.0.1:${(socks.address() as AddressInfo).port}` });
      dispatchers.add(getNetworkDispatcher());
      await expect(fetchWithNodeNetwork('https://api.opencli.test', { signal: AbortSignal.timeout(2000) })).rejects.toThrow();
      expect(greetings).toHaveLength(1);
      expect([...greetings[0]]).toEqual([5, 1, 0]);
      expect(connections).toEqual([]);
      expect(lookups).toEqual([]);
    } finally {
      await new Promise<void>(resolve => socks.close(() => resolve()));
    }
  });
});
