import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchDaemonStatusMock } = vi.hoisted(() => ({
  fetchDaemonStatusMock: vi.fn(),
}));

vi.mock('../browser/daemon-transport.js', () => ({
  fetchDaemonStatus: fetchDaemonStatusMock,
}));

vi.mock('../native-manifest.js', () => ({
  nativeHostManifestInstalled: () => true,
  installNativeHostManifest: () => ({ files: ['/tmp/com.opencli.host.json'], binaryPath: '/tmp/opencli-host' }),
  NATIVE_HOST_NAME: 'com.opencli.host',
}));

import { hostStatus } from './host.js';
import { PKG_VERSION } from '../version.js';

describe('hostStatus', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    fetchDaemonStatusMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports not running when no host is live', async () => {
    fetchDaemonStatusMock.mockResolvedValue(null);
    await hostStatus();
    expect(stdoutSpy).toHaveBeenCalledWith(expect.stringContaining('not running'));
  });

  it('shows host info when running', async () => {
    fetchDaemonStatusMock.mockResolvedValue({
      ok: true,
      pid: 12345,
      uptime: 3661,
      hostVersion: PKG_VERSION,
      daemonVersion: PKG_VERSION,
      extensionConnected: true,
      extensionVersion: '1.6.8',
      pending: 0,
      memoryMB: 64,
      sock: '/tmp/host.sock',
    });
    await hostStatus();
    const output = stdoutSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n');
    expect(output).toContain('running');
    expect(output).toContain('12345');
    expect(output).toContain('connected');
    expect(output).not.toContain('19825');
  });
});
