import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const requestHost = vi.fn();
vi.mock('./host-rpc.js', () => ({
  requestHost: (...args: unknown[]) => requestHost(...args),
  isPreConnectSocketError: (err: unknown) => {
    const code = err && typeof err === 'object' ? (err as { code?: string }).code : undefined;
    return code === 'ENOENT' || code === 'ECONNREFUSED' || code === 'ECONNRESET';
  },
}));

describe('fetchDaemonStatus stale-state handling', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
    requestHost.mockReset();
  });

  it('does not report ready when the RPC fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-stale-'));
    dirs.push(dir);
    vi.stubEnv('OPENCLI_CONFIG_DIR', dir);
    const run = path.join(dir, 'run');
    fs.mkdirSync(run);
    const sock = path.join(run, 'host-default.sock');
    fs.writeFileSync(sock, '');
    fs.writeFileSync(path.join(run, 'host-default.json'), JSON.stringify({
      pid: process.pid,
      sock,
      contextId: 'default',
      hostVersion: '2.0.0',
      extensionVersion: '1.0.24',
      extensionCompatRange: '>=2.0.0',
      startedAt: Date.now(),
    }));
    requestHost.mockRejectedValue(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }));

    const { fetchDaemonStatus, getDaemonHealth } = await import('./daemon-transport.js');
    const status = await fetchDaemonStatus();
    expect(status?.extensionConnected).toBe(false);
    expect(status?.ok).toBe(false);
    const health = await getDaemonHealth();
    expect(health.state).not.toBe('ready');
  });
});
