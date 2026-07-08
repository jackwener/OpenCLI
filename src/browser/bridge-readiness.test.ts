import { describe, expect, it, vi } from 'vitest';
import {
  PRE_DISPATCH_ERROR_CODES,
  isPreDispatchError,
  waitForBridgeReady,
  type DaemonHealth,
  type HealthFetcher,
} from './bridge-readiness.js';
import type { DaemonStatus } from './daemon-transport.js';

function status(extensionConnected: boolean): DaemonStatus {
  return {
    ok: true,
    pid: 1,
    uptime: 0,
    extensionConnected,
    pending: 0,
    memoryMB: 0,
    port: 19825,
  };
}

function readyHealth(): DaemonHealth {
  return { state: 'ready', status: status(true) };
}

function notReadyHealth(state: Exclude<DaemonHealth['state'], 'ready'>): DaemonHealth {
  if (state === 'stopped') return { state: 'stopped', status: null };
  return { state, status: status(false) };
}

describe('waitForBridgeReady', () => {
  it('returns immediately on the first ready health', async () => {
    const fetchHealth: HealthFetcher = vi.fn(async () => readyHealth());

    const result = await waitForBridgeReady(fetchHealth, { timeoutMs: 10_000, intervalMs: 1 });

    expect(result.state).toBe('ready');
    expect(fetchHealth).toHaveBeenCalledTimes(1);
  });

  it('polls until ready when initial reads are not ready', async () => {
    const sequence: DaemonHealth[] = [
      notReadyHealth('stopped'),
      notReadyHealth('no-extension'),
      readyHealth(),
    ];
    let i = 0;
    const fetchHealth: HealthFetcher = vi.fn(async () => sequence[i++] ?? readyHealth());

    const result = await waitForBridgeReady(fetchHealth, { timeoutMs: 10_000, intervalMs: 1 });

    expect(result.state).toBe('ready');
    expect(fetchHealth).toHaveBeenCalledTimes(3);
  });

  it('returns the last observed non-ready health when the deadline expires', async () => {
    const fetchHealth: HealthFetcher = vi.fn(async () => notReadyHealth('profile-disconnected'));

    const result = await waitForBridgeReady(fetchHealth, { timeoutMs: 25, intervalMs: 5 });

    expect(result.state).toBe('profile-disconnected');
    expect(vi.mocked(fetchHealth).mock.calls.length).toBeGreaterThan(1);
  });
});

describe('isPreDispatchError', () => {
  it('classifies only safe pre-dispatch daemon errors', () => {
    expect(isPreDispatchError('extension_not_connected')).toBe(true);
    expect(isPreDispatchError('profile_disconnected')).toBe(true);
    expect(isPreDispatchError('profile_required')).toBe(false);
    expect(isPreDispatchError('command_result_unknown')).toBe(false);
    expect(isPreDispatchError(undefined)).toBe(false);
    expect(PRE_DISPATCH_ERROR_CODES.size).toBe(2);
  });
});
