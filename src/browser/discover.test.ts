import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockBuildDaemonAuthHeaders = vi.fn(() => ({ 'X-OpenCLI': '1', Authorization: 'Bearer test-token' }));
const mockIsDaemonRunning = vi.fn();
const mockResetTokenCache = vi.fn();

vi.mock('./daemon-client.js', () => ({
  buildDaemonAuthHeaders: mockBuildDaemonAuthHeaders,
  isDaemonRunning: mockIsDaemonRunning,
  resetTokenCache: mockResetTokenCache,
}));

describe('checkDaemonStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses daemon auth headers and retries once on 401', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        extensionConnected: true,
        extensionVersion: '1.5.6',
      }), { status: 200 }));

    vi.stubGlobal('fetch', fetchMock);

    const { checkDaemonStatus } = await import('./discover.js');
    await expect(checkDaemonStatus()).resolves.toEqual({
      running: true,
      extensionConnected: true,
      extensionVersion: '1.5.6',
    });

    expect(mockBuildDaemonAuthHeaders).toHaveBeenCalledTimes(2);
    expect(mockResetTokenCache).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:19825/status',
      expect.objectContaining({
        headers: { 'X-OpenCLI': '1', Authorization: 'Bearer test-token' },
      }),
    );
  });
});
