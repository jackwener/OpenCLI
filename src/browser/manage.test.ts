import { afterEach, describe, expect, it, vi } from 'vitest';

const mockReadLaunchRegistry = vi.hoisted(() => vi.fn());
const mockIsProcessAlive = vi.hoisted(() => vi.fn());

vi.mock('./instances.js', () => ({
  readLaunchRegistry: mockReadLaunchRegistry,
  isProcessAlive: mockIsProcessAlive,
}));

import { stopBrowsers } from './manage.js';

describe('browser manage helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockReadLaunchRegistry.mockReset();
    mockIsProcessAlive.mockReset();
  });

  it('stops a browser tracked by port', async () => {
    mockReadLaunchRegistry.mockResolvedValue([
      {
        id: 'port-9339',
        pid: 12345,
        port: 9339,
        endpoint: 'http://127.0.0.1:9339',
        profileName: 'zhihu',
        userDataDir: '/tmp/profile-9339',
        userDataKind: 'persistent',
        launchMode: 'background',
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
    ]);
    mockIsProcessAlive
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true as any);
    const report = await stopBrowsers({ port: 9339, timeoutMs: 10 });

    expect(killSpy).toHaveBeenCalledWith(12345, 'SIGTERM');
    expect(report).toEqual({
      stopped: [{ pid: 12345, port: 9339 }],
      issues: [],
    });
  });
});
