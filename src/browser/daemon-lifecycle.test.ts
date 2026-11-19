import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserConnectError } from '../errors.js';
import { PKG_VERSION } from '../version.js';

const {
  getDaemonHealthMock,
  fetchDaemonStatusMock,
  requestDaemonShutdownMock,
  waitForBridgeReadyMock,
  loadLauncherConfigMock,
  runBrowserLauncherMock,
} = vi.hoisted(() => ({
  getDaemonHealthMock: vi.fn(),
  fetchDaemonStatusMock: vi.fn(),
  requestDaemonShutdownMock: vi.fn(),
  waitForBridgeReadyMock: vi.fn(),
  loadLauncherConfigMock: vi.fn(),
  runBrowserLauncherMock: vi.fn(),
}));

vi.mock('./daemon-transport.js', () => ({
  getDaemonHealth: getDaemonHealthMock,
  fetchDaemonStatus: fetchDaemonStatusMock,
  requestDaemonShutdown: requestDaemonShutdownMock,
}));

vi.mock('./bridge-readiness.js', () => ({
  waitForBridgeReady: waitForBridgeReadyMock,
}));

vi.mock('./browser-launcher.js', () => ({
  loadLauncherConfig: loadLauncherConfigMock,
  runBrowserLauncher: runBrowserLauncherMock,
}));

import { daemonLifecycleHooks, ensureBrowserBridgeReady } from './daemon-lifecycle.js';
import type { DaemonHealth, DaemonStatus } from './daemon-transport.js';

function makeStatus(overrides: Partial<DaemonStatus> = {}): DaemonStatus {
  return {
    ok: true,
    pid: 1234,
    uptime: 10,
    daemonVersion: PKG_VERSION,
    extensionConnected: false,
    pending: 0,
    memoryMB: 32,
    port: 19825,
    ...overrides,
  };
}

function makeHealth(state: DaemonHealth['state'], statusOverrides: Partial<DaemonStatus> = {}): DaemonHealth {
  if (state === 'stopped') return { state: 'stopped', status: null };
  return {
    state,
    status: makeStatus({
      extensionConnected: state === 'ready' || state === 'profile-required' || state === 'profile-disconnected',
      ...statusOverrides,
    }),
  } as DaemonHealth;
}

describe('ensureBrowserBridgeReady launcher recovery', () => {
  beforeEach(() => {
    getDaemonHealthMock.mockReset();
    fetchDaemonStatusMock.mockReset();
    requestDaemonShutdownMock.mockReset();
    waitForBridgeReadyMock.mockReset();
    loadLauncherConfigMock.mockReset();
    runBrowserLauncherMock.mockReset();
    vi.spyOn(daemonLifecycleHooks, 'spawnDaemonProcess').mockImplementation(() => ({ unref: () => {} }) as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws directly when no-extension and no launcher is configured', async () => {
    const noExt = makeHealth('no-extension');
    getDaemonHealthMock.mockResolvedValue(noExt);
    waitForBridgeReadyMock.mockResolvedValueOnce(noExt);
    loadLauncherConfigMock.mockReturnValue({});

    const restartSpy = vi.spyOn(daemonLifecycleHooks, 'restartDaemon');
    const launcherSpy = vi.spyOn(daemonLifecycleHooks, 'runBrowserLauncher');

    await expect(ensureBrowserBridgeReady({ verbose: false })).rejects.toMatchObject({
      name: 'BrowserConnectError',
      kind: 'extension-not-connected',
      message: 'Browser Bridge extension not connected',
    } satisfies Partial<BrowserConnectError>);

    expect(restartSpy).not.toHaveBeenCalled();
    expect(launcherSpy).not.toHaveBeenCalled();
    expect(waitForBridgeReadyMock).toHaveBeenCalledTimes(1);
  });

  it('escalates restartDaemon -> start -> restart in order and throws when all steps fail', async () => {
    const noExt = makeHealth('no-extension');
    getDaemonHealthMock.mockResolvedValue(noExt);
    waitForBridgeReadyMock.mockResolvedValue(noExt);
    loadLauncherConfigMock.mockReturnValue({ start: 'start-cmd', restart: 'restart-cmd' });

    const order: string[] = [];
    vi.spyOn(daemonLifecycleHooks, 'restartDaemon').mockImplementation(async () => {
      order.push('restartDaemon');
      return { previousStatus: noExt.status, status: noExt.status, stopped: true, spawned: true };
    });
    vi.spyOn(daemonLifecycleHooks, 'runBrowserLauncher').mockImplementation((kind) => {
      order.push(kind);
      return true;
    });

    await expect(ensureBrowserBridgeReady({ verbose: false })).rejects.toMatchObject({
      name: 'BrowserConnectError',
      kind: 'extension-not-connected',
      message: 'Browser Bridge extension not connected',
    } satisfies Partial<BrowserConnectError>);

    expect(order).toEqual(['restartDaemon', 'start', 'restart']);
    expect(waitForBridgeReadyMock).toHaveBeenCalledTimes(4);
  });

  it('returns early when restartDaemon makes the bridge ready', async () => {
    const noExt = makeHealth('no-extension');
    const ready = makeHealth('ready');
    getDaemonHealthMock.mockResolvedValue(noExt);
    waitForBridgeReadyMock
      .mockResolvedValueOnce(noExt)
      .mockResolvedValueOnce(ready);
    loadLauncherConfigMock.mockReturnValue({ start: 'start-cmd', restart: 'restart-cmd' });

    const restartSpy = vi.spyOn(daemonLifecycleHooks, 'restartDaemon').mockResolvedValue({
      previousStatus: noExt.status,
      status: ready.status,
      stopped: true,
      spawned: true,
    });
    const launcherSpy = vi.spyOn(daemonLifecycleHooks, 'runBrowserLauncher');

    await expect(ensureBrowserBridgeReady({ verbose: false })).resolves.toEqual(ready);

    expect(restartSpy).toHaveBeenCalledTimes(1);
    expect(launcherSpy).not.toHaveBeenCalled();
    expect(waitForBridgeReadyMock).toHaveBeenCalledTimes(2);
  });

  it('returns early when browser start makes the bridge ready', async () => {
    const noExt = makeHealth('no-extension');
    const ready = makeHealth('ready');
    getDaemonHealthMock.mockResolvedValue(noExt);
    waitForBridgeReadyMock
      .mockResolvedValueOnce(noExt)
      .mockResolvedValueOnce(noExt)
      .mockResolvedValueOnce(ready);
    loadLauncherConfigMock.mockReturnValue({ start: 'start-cmd', restart: 'restart-cmd' });

    vi.spyOn(daemonLifecycleHooks, 'restartDaemon').mockResolvedValue({
      previousStatus: noExt.status,
      status: noExt.status,
      stopped: true,
      spawned: true,
    });
    const launcherSpy = vi.spyOn(daemonLifecycleHooks, 'runBrowserLauncher').mockReturnValue(true);

    await expect(ensureBrowserBridgeReady({ verbose: false })).resolves.toEqual(ready);

    expect(launcherSpy).toHaveBeenCalledTimes(1);
    expect(launcherSpy).toHaveBeenCalledWith('start');
    expect(waitForBridgeReadyMock).toHaveBeenCalledTimes(3);
  });

  it('returns early when browser restart makes the bridge ready', async () => {
    const noExt = makeHealth('no-extension');
    const ready = makeHealth('ready');
    getDaemonHealthMock.mockResolvedValue(noExt);
    waitForBridgeReadyMock
      .mockResolvedValueOnce(noExt)
      .mockResolvedValueOnce(noExt)
      .mockResolvedValueOnce(noExt)
      .mockResolvedValueOnce(ready);
    loadLauncherConfigMock.mockReturnValue({ start: 'start-cmd', restart: 'restart-cmd' });

    vi.spyOn(daemonLifecycleHooks, 'restartDaemon').mockResolvedValue({
      previousStatus: noExt.status,
      status: noExt.status,
      stopped: true,
      spawned: true,
    });
    const launcherSpy = vi.spyOn(daemonLifecycleHooks, 'runBrowserLauncher').mockReturnValue(true);

    await expect(ensureBrowserBridgeReady({ verbose: false })).resolves.toEqual(ready);

    expect(launcherSpy.mock.calls).toEqual([['start'], ['restart']]);
    expect(waitForBridgeReadyMock).toHaveBeenCalledTimes(4);
  });

  it('skips waitForBridgeReady for steps that return false and continues escalating', async () => {
    const noExt = makeHealth('no-extension');
    const ready = makeHealth('ready');
    getDaemonHealthMock.mockResolvedValue(noExt);
    waitForBridgeReadyMock
      .mockResolvedValueOnce(noExt)
      .mockResolvedValueOnce(ready);
    loadLauncherConfigMock.mockReturnValue({ start: 'start-cmd', restart: 'restart-cmd' });

    vi.spyOn(daemonLifecycleHooks, 'restartDaemon').mockResolvedValue({
      previousStatus: noExt.status,
      status: noExt.status,
      stopped: false,
      spawned: false,
    });
    const launcherSpy = vi.spyOn(daemonLifecycleHooks, 'runBrowserLauncher')
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    await expect(ensureBrowserBridgeReady({ verbose: false })).resolves.toEqual(ready);

    expect(launcherSpy.mock.calls).toEqual([['start'], ['restart']]);
    expect(waitForBridgeReadyMock).toHaveBeenCalledTimes(2);
  });

  it('does not run launcher recovery when waitForBridgeReady ends in a non-no-extension state', async () => {
    const stopped = makeHealth('stopped');
    const disconnected = makeHealth('profile-disconnected', { contextId: 'work' });
    getDaemonHealthMock.mockResolvedValue(stopped);
    waitForBridgeReadyMock.mockResolvedValueOnce(disconnected);
    loadLauncherConfigMock.mockReturnValue({ start: 'start-cmd', restart: 'restart-cmd' });

    const restartSpy = vi.spyOn(daemonLifecycleHooks, 'restartDaemon');
    const launcherSpy = vi.spyOn(daemonLifecycleHooks, 'runBrowserLauncher');

    await expect(ensureBrowserBridgeReady({ contextId: 'work', verbose: false })).rejects.toMatchObject({
      name: 'BrowserConnectError',
      kind: 'profile-disconnected',
      message: 'Browser profile "work" is not connected',
    } satisfies Partial<BrowserConnectError>);

    expect(restartSpy).not.toHaveBeenCalled();
    expect(launcherSpy).not.toHaveBeenCalled();
  });
});
