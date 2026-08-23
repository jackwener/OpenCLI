import { afterEach, describe, expect, it, vi } from 'vitest';

const requestHost = vi.fn();
const ensureBrowserBridgeReady = vi.fn();
const listLiveHostStates = vi.fn();

vi.mock('./host-rpc.js', () => ({
  requestHost: (...args: unknown[]) => requestHost(...args),
  isPreConnectSocketError: (err: unknown) => {
    const code = err && typeof err === 'object' ? (err as { code?: string }).code : undefined;
    return code === 'ENOENT' || code === 'ECONNREFUSED';
  },
  PRE_CONNECT_SOCKET_CODES: new Set(['ENOENT', 'ECONNREFUSED']),
}));

vi.mock('./daemon-lifecycle.js', () => ({
  ensureBrowserBridgeReady: (...args: unknown[]) => ensureBrowserBridgeReady(...args),
}));

vi.mock('../host-protocol.js', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    listLiveHostStates: (...args: unknown[]) => listLiveHostStates(...args),
  };
});

describe('sendCommand write-safety', () => {
  afterEach(() => {
    requestHost.mockReset();
    ensureBrowserBridgeReady.mockReset();
    listLiveHostStates.mockReset();
  });

  it('does not retry unknown-outcome codes', async () => {
    listLiveHostStates.mockReturnValue([{ sock: '/tmp/h.sock', contextId: 'default', pid: 1 }]);
    requestHost.mockResolvedValue({
      id: 'cmd',
      ok: false,
      error: 'unknown',
      errorCode: 'command_result_unknown',
    });
    const { sendCommand, BrowserCommandError } = await import('./daemon-client.js');
    await expect(sendCommand('exec', { code: '1' })).rejects.toBeInstanceOf(BrowserCommandError);
    expect(requestHost).toHaveBeenCalledTimes(1);
  });

  it('resends the same command id after a journaled transport drop', async () => {
    listLiveHostStates.mockReturnValue([{ sock: '/tmp/h.sock', contextId: 'default', pid: 1 }]);
    ensureBrowserBridgeReady.mockResolvedValue({
      state: 'ready',
      status: { extensionVersion: '1.0.24', extensionConnected: true },
    });
    requestHost
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce({ id: 'cmd', ok: true, data: { v: 1 } });

    const { sendCommand } = await import('./daemon-client.js');
    await expect(sendCommand('exec', { code: '1' })).resolves.toEqual({ v: 1 });
    const ids = requestHost.mock.calls.map((c) => (c[1] as { id: string }).id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it('classifies a non-journaled mid-command drop as unknown outcome', async () => {
    listLiveHostStates.mockReturnValue([{ sock: '/tmp/h.sock', contextId: 'default', pid: 1 }]);
    ensureBrowserBridgeReady.mockResolvedValue({
      state: 'ready',
      status: { extensionVersion: '1.0.21', extensionConnected: true },
    });
    requestHost.mockRejectedValueOnce(new Error('socket hang up'));

    const { sendCommand, BrowserCommandError } = await import('./daemon-client.js');
    try {
      await sendCommand('exec', { code: '1' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BrowserCommandError);
      expect((err as { code?: string }).code).toBe('command_result_unknown');
    }
    expect(requestHost).toHaveBeenCalledTimes(1);
  });
});
