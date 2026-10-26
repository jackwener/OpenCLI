import { EventEmitter } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

import { isIpv6LoopbackUnavailable, listenDaemonLoopback } from './daemon-listen.js';

const trackedServers: Server[] = [];

function createHttpPair(): { ipv4: Server; ipv6: Server } {
  const handler = (_req: IncomingMessage, res: ServerResponse) => { res.end('ok'); };
  const pair = { ipv4: createServer(handler), ipv6: createServer(handler) };
  trackedServers.push(pair.ipv4, pair.ipv6);
  return pair;
}

/**
 * Fake `http.Server` whose `listen` synchronously records the intent and then
 * emits either an error or the listening callback — enough to exercise the
 * error-routing branches without binding real sockets.
 */
function fakeServer(options: { error?: NodeJS.ErrnoException } = {}): Server {
  const emitter = new EventEmitter() as unknown as Server & EventEmitter;
  const state = emitter as unknown as {
    listening: boolean;
    listen: (port: number, host: string, callback?: () => void) => Server;
    close: () => Server;
  };
  state.listening = false;
  state.listen = (_port: number, _host: string, callback?: () => void) => {
    if (options.error) setImmediate(() => emitter.emit('error', options.error));
    else if (callback) setImmediate(callback);
    return emitter as unknown as Server;
  };
  state.close = () => emitter as unknown as Server;
  return emitter as unknown as Server;
}

async function closeTrackedServers(): Promise<void> {
  await Promise.all(trackedServers.splice(0).map(async (server) => {
    if (!server.listening) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }));
}

async function getFreeLoopbackPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', () => resolve()));
  const address = probe.address();
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  if (typeof address !== 'object' || address === null) throw new Error('failed to allocate a loopback port');
  return address.port;
}

afterEach(async () => {
  await closeTrackedServers();
});

describe('isIpv6LoopbackUnavailable', () => {
  it('treats missing address-family support as an optional IPv6 loopback', () => {
    for (const code of ['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EINVAL', 'EPROTONOSUPPORT', 'ENETUNREACH']) {
      expect(isIpv6LoopbackUnavailable(Object.assign(new Error(code), { code }))).toBe(true);
    }
  });

  it('keeps real bind failures fatal', () => {
    for (const code of ['EADDRINUSE', 'EACCES', 'EMFILE', '']) {
      expect(isIpv6LoopbackUnavailable(Object.assign(new Error(code), { code }))).toBe(false);
    }
  });
});

describe('listenDaemonLoopback', () => {
  it('serves 127.0.0.1 and ::1 from the same handler', async () => {
    const servers = createHttpPair();
    const port = await getFreeLoopbackPort();
    let ipv6Unavailable: NodeJS.ErrnoException | null = null;

    await new Promise<void>((resolve, reject) => {
      let ipv4Ready = false;
      let ipv6Settled = false;
      const maybeResolve = () => {
        if (ipv4Ready && ipv6Settled) resolve();
      };
      listenDaemonLoopback(servers, port, {
        onListening: (host) => {
          if (host === '127.0.0.1') ipv4Ready = true;
          else ipv6Settled = true;
          maybeResolve();
        },
        onIpv6Unavailable: (error) => {
          ipv6Unavailable = error;
          ipv6Settled = true;
          maybeResolve();
        },
        onError: (error) => reject(error),
      });
    });

    const ipv4Response = await fetch(`http://127.0.0.1:${port}/`);
    expect(ipv4Response.status).toBe(200);
    expect(await ipv4Response.text()).toBe('ok');

    if (ipv6Unavailable) {
      // Host genuinely has no IPv6 loopback: the daemon must have kept the
      // IPv4 listener and reported the fallback instead of failing.
      expect(isIpv6LoopbackUnavailable(ipv6Unavailable)).toBe(true);
    } else {
      const ipv6Response = await fetch(`http://[::1]:${port}/`);
      expect(ipv6Response.status).toBe(200);
      expect(await ipv6Response.text()).toBe('ok');
    }
  });

  it('keeps serving when the host has no IPv6 loopback', async () => {
    const error = Object.assign(new Error('no ipv6'), { code: 'EAFNOSUPPORT' });
    const events: string[] = [];
    await new Promise<void>((resolve) => {
      listenDaemonLoopback({ ipv4: fakeServer(), ipv6: fakeServer({ error }) }, 19825, {
        onIpv6Unavailable: (err) => { events.push(`unavailable:${err.code}`); resolve(); },
        onError: (err) => { events.push(`error:${err.code}`); resolve(); },
      });
    });
    expect(events).toEqual(['unavailable:EAFNOSUPPORT']);
  });

  it('treats a real IPv6 bind failure as fatal', async () => {
    const error = Object.assign(new Error('port busy'), { code: 'EADDRINUSE' });
    const events: string[] = [];
    await new Promise<void>((resolve) => {
      listenDaemonLoopback({ ipv4: fakeServer(), ipv6: fakeServer({ error }) }, 19825, {
        onIpv6Unavailable: (err) => { events.push(`unavailable:${err.code}`); resolve(); },
        onError: (err) => { events.push(`error:${err.code}`); resolve(); },
      });
    });
    expect(events).toEqual(['error:EADDRINUSE']);
  });

  it('reports IPv4 bind failures as fatal', async () => {
    const error = Object.assign(new Error('port busy'), { code: 'EADDRINUSE' });
    const events: string[] = [];
    await new Promise<void>((resolve) => {
      listenDaemonLoopback({ ipv4: fakeServer({ error }), ipv6: fakeServer() }, 19825, {
        onError: (err) => { events.push(`error:${err.code}`); resolve(); },
      });
    });
    expect(events).toEqual(['error:EADDRINUSE']);
  });
});
