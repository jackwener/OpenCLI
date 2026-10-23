import type { Server } from 'node:http';

/**
 * Loopback addresses the daemon must serve.
 *
 * `localhost` is not usable as a single listen address: on IPv6-preferring
 * hosts (notably Windows) it resolves to `::1`, while the CLI probes
 * `http://127.0.0.1:19825` and the Browser Bridge extension connects to
 * `ws://localhost:19825/ext`. Binding both loopback families keeps every
 * component on the same endpoint set regardless of how `localhost` resolves.
 */
export const DAEMON_LOOPBACK_HOSTS = ['127.0.0.1', '::1'] as const;

export type DaemonLoopbackHost = (typeof DAEMON_LOOPBACK_HOSTS)[number];

/**
 * Listen errors that mean "this host has no usable IPv6 loopback" (IPv6
 * disabled, address family unsupported): they must not stop the daemon from
 * serving IPv4 loopback. Every other error is a real listener failure.
 */
const IPV6_LOOPBACK_UNAVAILABLE_CODES = new Set([
  'EAFNOSUPPORT',
  'EADDRNOTAVAIL',
  'EINVAL',
  'EPROTONOSUPPORT',
  'ENETUNREACH',
]);

export function isIpv6LoopbackUnavailable(error: NodeJS.ErrnoException): boolean {
  return IPV6_LOOPBACK_UNAVAILABLE_CODES.has(error.code ?? '');
}

export type DaemonLoopbackServers = {
  ipv4: Server;
  ipv6: Server;
};

export type ListenDaemonLoopbackOptions = {
  /** Called once per loopback family that started listening. */
  onListening?: (host: DaemonLoopbackHost) => void;
  /** The host has no usable IPv6 loopback; the daemon serves 127.0.0.1 only. */
  onIpv6Unavailable?: (error: NodeJS.ErrnoException) => void;
  /** Fatal listener failure (including IPv4 bind failures). */
  onError?: (error: NodeJS.ErrnoException) => void;
};

/**
 * Start both daemon listeners on the same port.
 *
 * The two `http.Server` instances share request/upgrade handlers upstream, so
 * the only difference is the address family. A missing IPv6 loopback is
 * reported through `onIpv6Unavailable` instead of surfacing as a startup
 * failure; IPv4 listen failures stay fatal for the caller.
 */
export function listenDaemonLoopback(
  servers: DaemonLoopbackServers,
  port: number,
  options: ListenDaemonLoopbackOptions = {},
): void {
  const { ipv4, ipv6 } = servers;

  ipv4.on('error', (error: NodeJS.ErrnoException) => options.onError?.(error));
  ipv4.listen(port, '127.0.0.1', () => options.onListening?.('127.0.0.1'));

  ipv6.on('error', (error: NodeJS.ErrnoException) => {
    if (isIpv6LoopbackUnavailable(error)) {
      options.onIpv6Unavailable?.(error);
      return;
    }
    options.onError?.(error);
  });
  ipv6.listen(port, '::1', () => options.onListening?.('::1'));
}
