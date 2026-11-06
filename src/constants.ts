/**
 * Shared constants used across explore, synthesize, and pipeline modules.
 */

/** Default daemon port for HTTP/WebSocket communication with browser extension */
export const DEFAULT_DAEMON_PORT = 19825;

/**
 * Loopback address the daemon binds and every client dials: the CLI transport
 * here and the Browser Bridge extension (mirrored as DAEMON_HOST in
 * extension/src/protocol.ts). An IP literal on purpose: `localhost` resolves
 * to ::1 first on IPv6-preferring hosts (notably Windows), so a client dialing
 * `localhost` can miss a daemon listening on 127.0.0.1 (#2690, #2762).
 */
export const DAEMON_HOST = '127.0.0.1';

export function unsupportedDaemonPortEnvMessage(value?: string): string {
  const suffix = value ? ` (received ${value})` : '';
  return `OPENCLI_DAEMON_PORT is no longer supported${suffix}. ` +
    `The OpenCLI Chrome extension can only connect to ${DAEMON_HOST}:${DEFAULT_DAEMON_PORT}. ` +
    'Unset OPENCLI_DAEMON_PORT and rerun opencli.';
}

/**
 * True when OPENCLI_DAEMON_PORT carries no real configuration: unset, empty,
 * or equal to the default port. Launchers (notably OpenCLIApp) inject the
 * variable with the default value into every CLI they manage — rejecting that
 * harmless redundancy bricked all commands on fresh installs (#2068). Only a
 * NON-default value is a genuine misconfiguration worth failing on.
 */
export function isIgnorableDaemonPortEnv(value: string | undefined): boolean {
  if (value === undefined) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  return Number(trimmed) === DEFAULT_DAEMON_PORT;
}
