import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ status: vi.fn(), stop: vi.fn(), restart: vi.fn() }));
vi.mock('../browser/daemon-transport.js', () => ({ fetchDaemonStatus: mocks.status, requestDaemonShutdown: mocks.stop }));
vi.mock('../browser/daemon-lifecycle.js', () => ({ restartDaemon: mocks.restart }));
import { daemonStatus, daemonStop, daemonRestart } from './daemon.js';
import { PKG_VERSION } from '../version.js';
let stdout: ReturnType<typeof vi.spyOn>;
const status = { daemonVersion: PKG_VERSION, pid: 42, uptime: 60, extensionConnected: true, memoryMB: 32, port: 19825 };
function result() {
  expect(stdout).toHaveBeenCalledTimes(1);
  return JSON.parse(stdout.mock.calls[0][0]);
}
beforeEach(() => { vi.resetAllMocks(); stdout = vi.spyOn(console, 'log').mockImplementation(() => {}); process.exitCode = undefined; });
afterEach(() => { vi.restoreAllMocks(); process.exitCode = undefined; });
describe('daemon structured output', () => {
  it('reports an unreachable daemon', async () => {
    mocks.status.mockResolvedValue(null); await daemonStatus();
    expect(result()).toEqual({ ok: true, data: { running: false } });
  });
  it('preserves running daemon facts', async () => {
    mocks.status.mockResolvedValue(status); await daemonStatus();
    expect(result()).toEqual({ ok: true, data: { ...status, running: true, stale: false } });
  });
  it.each(['profileRequired', 'profileDisconnected'])('preserves %s and supplies a recovery hint', async flag => {
    mocks.status.mockResolvedValue({ ...status, extensionConnected: false, [flag]: true }); await daemonStatus();
    expect(result().data).toMatchObject({ [flag]: true, hint: expect.stringContaining('opencli profile use') });
  });
  it('distinguishes zero connected profiles from missing selection', async () => {
    mocks.status.mockResolvedValue({ ...status, extensionConnected: false, profiles: [] }); await daemonStatus();
    expect(result().data).toMatchObject({ extensionConnected: false, profiles: [] });
  });
  it('reports stale daemon versions', async () => {
    mocks.status.mockResolvedValue({ ...status, daemonVersion: '0.0.1' }); await daemonStatus();
    expect(result().data.stale).toBe(true);
  });
  it('stops idempotently when absent', async () => {
    mocks.status.mockResolvedValue(null); await daemonStop();
    expect(result().data).toEqual({ running: false, stopped: false }); expect(mocks.stop).not.toHaveBeenCalled();
  });
  it('stops a running daemon', async () => {
    mocks.status.mockResolvedValue(status); mocks.stop.mockResolvedValue(true); await daemonStop();
    expect(result().data).toEqual({ running: false, stopped: true });
  });
  it('reports a shutdown failure', async () => {
    mocks.status.mockResolvedValue(status); mocks.stop.mockResolvedValue(false); await daemonStop();
    expect(result().error.code).toBe('daemon_stop_failed'); expect(process.exitCode).toBe(1);
  });
  it.each([true, false])('reports restart action when previous daemon exists: %s', async previous => {
    mocks.restart.mockResolvedValue({ stopped: true, status, previousStatus: previous ? status : null }); await daemonRestart();
    expect(result().data).toEqual({ action: previous ? 'restarted' : 'started', status });
  });
  it('reports restart stop failure', async () => {
    mocks.restart.mockResolvedValue({ stopped: false }); await daemonRestart();
    expect(result().error.code).toBe('daemon_stop_failed'); expect(process.exitCode).toBe(1);
  });
  it('reports unknown outcome after a restart timeout', async () => {
    mocks.restart.mockResolvedValue({ stopped: true, status: null }); await daemonRestart();
    expect(result().error).toMatchObject({ code: 'outcome_unknown', outcome: 'unknown' });
  });
});
