import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ElectronAppEntry } from './electron-apps.js';
import { detectProcess, discoverAppPath, electronLaunchArgs, launchDetachedApp, launchElectronApp, probeCDP, resolveElectronEndpoint, resolveExecutableCandidates } from './launcher.js';

interface MockChildProcess {
  once: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  unref: ReturnType<typeof vi.fn>;
  emit: (event: string, value?: unknown) => void;
}

function createMockChildProcess(): MockChildProcess {
  const listeners = new Map<string, Array<(value?: unknown) => void>>();

  return {
    once: vi.fn((event: string, handler: (value?: unknown) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    }),
    off: vi.fn((event: string, handler: (value?: unknown) => void) => {
      listeners.set(event, (listeners.get(event) ?? []).filter((listener) => listener !== handler));
    }),
    unref: vi.fn(),
    emit: (event: string, value?: unknown) => {
      for (const listener of listeners.get(event) ?? []) listener(value);
    },
  };
}

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock('./electron-apps.js', () => ({
  getElectronApp: vi.fn(),
}));

vi.mock('./tui.js', () => ({
  confirmPrompt: vi.fn(() => Promise.resolve(true)),
}));

const cp = vi.mocked(await import('node:child_process'));
const electronApps = vi.mocked(await import('./electron-apps.js'));

describe('probeCDP', () => {
  it('returns false when CDP endpoint is unreachable', async () => {
    const result = await probeCDP(59999, 500);
    expect(result).toBe(false);
  });
});

describe('resolveElectronEndpoint', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    cp.execFileSync.mockReset();
    electronApps.getElectronApp.mockReset();
  });

  it('degrades gracefully on non-darwin without killing the running app', async () => {
    // Auto-launch (process detect → kill → discover → relaunch) is macOS-only:
    // discoverAppPath resolves a path on darwin alone. On other platforms
    // resolveElectronEndpoint must NOT enter the kill branch, which would
    // pkill the user's app and then fail at discoverAppPath (returns null),
    // leaving the app dead with a misleading "not installed" error.
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    // Port 59999 has no listener, so probeCDP resolves false (see above).
    electronApps.getElectronApp.mockReturnValue({
      port: 59999,
      processName: 'TestApp',
      displayName: 'TestApp',
    } as ElectronAppEntry);

    const err = await resolveElectronEndpoint('testapp').then(
      () => { throw new Error('expected resolveElectronEndpoint to reject'); },
      (e) => e as { message: string; hint?: string },
    );
    // Graceful degradation: the "not reachable" guard message + a linux
    // auto-launch hint, NOT the destructive "Could not find ... on this
    // machine" error that follows a kill.
    expect(err.message).toMatch(/is not reachable on CDP port/);
    expect(err.message).not.toMatch(/Could not find/);
    expect(err.hint).toMatch(/Auto-launch is not yet supported on linux/);
    // The destructive pkill path must never run on a non-darwin platform.
    expect(cp.execFileSync).not.toHaveBeenCalledWith('pkill', expect.anything(), expect.anything());
  });
});

describe('detectProcess', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns false when pgrep finds no process', () => {
    cp.execFileSync.mockImplementation(() => {
      const err = new Error('exit 1') as Error & { status: number };
      err.status = 1;
      throw err;
    });
    const result = detectProcess('NonExistentApp');
    expect(result).toBe(false);
  });

  it.skipIf(process.platform === 'win32')('returns true when pgrep finds a process', () => {
    cp.execFileSync.mockReturnValue('12345\n');
    const result = detectProcess('Cursor');
    expect(result).toBe(true);
  });
});

describe('discoverAppPath', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.skipIf(process.platform !== 'darwin')('returns path when osascript succeeds', () => {
    cp.execFileSync.mockReturnValue('/Applications/Cursor.app/\n');
    const result = discoverAppPath('Cursor');
    expect(result).toBe('/Applications/Cursor.app');
  });

  it.skipIf(process.platform !== 'darwin')('returns null when osascript fails', () => {
    cp.execFileSync.mockImplementation(() => {
      throw new Error('app not found');
    });
    const result = discoverAppPath('NonExistent');
    expect(result).toBeNull();
  });

  it.skipIf(process.platform === 'darwin')('returns null on non-darwin platform', () => {
    const result = discoverAppPath('Cursor');
    expect(result).toBeNull();
  });
});

describe('launchDetachedApp', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    cp.spawn.mockReset();
  });

  it('unrefs the process after spawn succeeds', async () => {
    const child = createMockChildProcess();
    cp.spawn.mockImplementation(() => {
      queueMicrotask(() => child.emit('spawn'));
      return child as unknown as ReturnType<typeof cp.spawn>;
    });

    await expect(launchDetachedApp('/Applications/Antigravity.app/Contents/MacOS/Antigravity', ['--remote-debugging-port=9234'], 'Antigravity'))
      .resolves
      .toBeUndefined();
    expect(child.unref).toHaveBeenCalledTimes(1);
  });

  it('converts ENOENT into a controlled launch error', async () => {
    const child = createMockChildProcess();
    cp.spawn.mockImplementation(() => {
      queueMicrotask(() => child.emit('error', Object.assign(new Error('missing binary'), { code: 'ENOENT' })));
      return child as unknown as ReturnType<typeof cp.spawn>;
    });

    await expect(launchDetachedApp('/Applications/Antigravity.app/Contents/MacOS/Antigravity', ['--remote-debugging-port=9234'], 'Antigravity'))
      .rejects
      .toThrow('Could not launch Antigravity');
    expect(child.unref).not.toHaveBeenCalled();
  });
});

describe('resolveExecutableCandidates', () => {
  it('prefers explicit executable candidates over processName', () => {
    const app: ElectronAppEntry = {
      port: 9234,
      processName: 'Antigravity',
      executableNames: ['Electron', 'Antigravity'],
    };

    expect(resolveExecutableCandidates('/Applications/Antigravity.app', app)).toEqual([
      '/Applications/Antigravity.app/Contents/MacOS/Electron',
      '/Applications/Antigravity.app/Contents/MacOS/Antigravity',
    ]);
  });
});

describe('electronLaunchArgs', () => {
  it('includes Chromium 142 WebSocket origin allow-list for auto-launched Electron apps', () => {
    expect(electronLaunchArgs(9234)).toEqual([
      '--remote-debugging-port=9234',
      '--remote-allow-origins=*',
    ]);
  });

  it('preserves app-specific extra launch args after the required CDP flags', () => {
    expect(electronLaunchArgs(9234, ['--foo=bar'])).toEqual([
      '--remote-debugging-port=9234',
      '--remote-allow-origins=*',
      '--foo=bar',
    ]);
  });
});

describe('launchElectronApp', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    cp.spawn.mockReset();
  });

  it('falls back to the next executable candidate when the first is missing', async () => {
    const firstChild = createMockChildProcess();
    const secondChild = createMockChildProcess();
    const app: ElectronAppEntry = {
      port: 9234,
      processName: 'Antigravity',
      executableNames: ['Electron', 'Antigravity'],
    };

    cp.spawn
      .mockImplementationOnce(() => {
        queueMicrotask(() => firstChild.emit('error', Object.assign(new Error('missing binary'), { code: 'ENOENT' })));
        return firstChild as unknown as ReturnType<typeof cp.spawn>;
      })
      .mockImplementationOnce(() => {
        queueMicrotask(() => secondChild.emit('spawn'));
        return secondChild as unknown as ReturnType<typeof cp.spawn>;
      });

    await expect(
      launchElectronApp('/Applications/Antigravity.app', app, ['--remote-debugging-port=9234'], 'Antigravity'),
    ).resolves.toBeUndefined();

    expect(cp.spawn).toHaveBeenNthCalledWith(
      1,
      '/Applications/Antigravity.app/Contents/MacOS/Electron',
      ['--remote-debugging-port=9234'],
      { detached: true, stdio: 'ignore' },
    );
    expect(cp.spawn).toHaveBeenNthCalledWith(
      2,
      '/Applications/Antigravity.app/Contents/MacOS/Antigravity',
      ['--remote-debugging-port=9234'],
      { detached: true, stdio: 'ignore' },
    );
    expect(secondChild.unref).toHaveBeenCalledTimes(1);
  });
});
