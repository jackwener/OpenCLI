import type { DaemonHealth } from './daemon-transport.js';

export type { DaemonHealth };

export type HealthFetcher = (opts?: { timeout?: number; contextId?: string }) => Promise<DaemonHealth>;

const DEFAULT_POLL_INTERVAL_MS = 200;

export async function waitForBridgeReady(
  fetchHealth: HealthFetcher,
  opts: { timeoutMs: number; contextId?: string; intervalMs?: number },
): Promise<DaemonHealth> {
  const interval = opts.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let health = await fetchHealth({ contextId: opts.contextId });
  if (health.state === 'ready') return health;

  const deadline = Date.now() + opts.timeoutMs;
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, interval));
    health = await fetchHealth({ contextId: opts.contextId });
    if (health.state === 'ready') return health;
  }
  return health;
}

export const PRE_DISPATCH_ERROR_CODES = new Set([
  'extension_not_connected',
  'profile_disconnected',
] as const);

export type PreDispatchErrorCode = typeof PRE_DISPATCH_ERROR_CODES extends Set<infer T> ? T : never;

export function isPreDispatchError(errorCode: string | undefined): boolean {
  if (!errorCode) return false;
  return (PRE_DISPATCH_ERROR_CODES as Set<string>).has(errorCode);
}
