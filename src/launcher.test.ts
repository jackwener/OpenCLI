import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import { createServer } from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { getElectronApp, type ElectronAppEntry } from './electron-apps.js';
import {
  detectAppProcess,
  detectProcess,
  discoverAppPath,
  discoverWindowsAppPath,
  electronLaunchArgs,
  findAppProcessPids,
  killAppProcess,
  launchDetachedApp,
  launchElectronApp,
  probeCDP,
  probeCDPEndpoint,
  resolveElectronEndpoint,
  resolveExecutableCandidates,
} from './launcher.js';

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
vi.mock('./tui.js', () => ({
  confirmPrompt: vi.fn(),
}));

const cp = vi.mocked(await import('node:child_process'));
const tui = vi.mocked(await import('./tui.js'));

describe('probeCDP', () => {
  it('returns false when CDP endpoint is unreachable', async () => {
    const result = await probeCDP(59999, 500);
    expect(result).toBe(false);
  });

  it('validates the expected Electron target host', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([{ type: 'page', url: 'https://discord.com/channels/@me' }]));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not expose a TCP port');

    try {
      await expect(probeCDP(address.port, 500, ['discord.com'])).resolves.toBe(true);
      await expect(probeCDP(address.port, 500, ['example.com'])).resolves.toBe(false);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('probes the exact custom endpoint and preserves its path prefix', async () => {
    const seenPaths: string[] = [];
    const server = createServer((req, res) => {
      seenPaths.push(req.url ?? '');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([{ type: 'page', url: 'https://discord.com/channels/@me' }]));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not expose a TCP port');

    try {
      await expect(
        probeCDPEndpoint(`http://127.0.0.1:${address.port}/custom-cdp`, 500, ['discord.com']),
      ).resolves.toBe(true);
      expect(seenPaths).toEqual(['/custom-cdp/json']);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it('rejects malformed and non-HTTP custom endpoints', async () => {
    await expect(probeCDPEndpoint('not a URL')).resolves.toBe(false);
    await expect(probeCDPEndpoint('ws://127.0.0.1:9232')).resolves.toBe(false);
  });
});

describe('detectProcess', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    cp.execFileSync.mockReset();
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
    cp.execFileSync.mockReset();
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

  it.skipIf(process.platform !== 'darwin')('uses bundle id Spotlight fallback when osascript cannot resolve the display name', () => {
    cp.execFileSync
      .mockImplementationOnce(() => {
        throw new Error('osascript timed out');
      })
      .mockReturnValueOnce('/Applications/ChatGPT.app\n');

    const result = discoverAppPath('Codex', 'com.openai.codex');

    expect(result).toBe('/Applications/ChatGPT.app');
    expect(cp.execFileSync).toHaveBeenNthCalledWith(
      1,
      'osascript',
      ['-e', 'POSIX path of (path to application id "com.openai.codex")'],
      { encoding: 'utf-8', stdio: 'pipe', timeout: 5_000 },
    );
    expect(cp.execFileSync).toHaveBeenNthCalledWith(
      2,
      'mdfind',
      ['kMDItemCFBundleIdentifier == "com.openai.codex"'],
      { encoding: 'utf-8', stdio: 'pipe', timeout: 5_000 },
    );
  });

  it.skipIf(process.platform === 'darwin')('returns null on non-darwin platform', () => {
    const result = discoverAppPath('Cursor');
    expect(result).toBeNull();
  });
});

describe('discoverWindowsAppPath', () => {
  it('chooses the newest Squirrel app directory from an explicit install root', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-windows-launcher-'));
    const installRoot = path.join(tempDir, 'Discord');
    const olderDir = path.join(installRoot, 'app-1.0.9');
    const newerDir = path.join(installRoot, 'app-1.0.10');
    fs.mkdirSync(olderDir, { recursive: true });
    fs.mkdirSync(newerDir, { recursive: true });
    fs.writeFileSync(path.join(olderDir, 'Discord.exe'), '');
    fs.writeFileSync(path.join(newerDir, 'Discord.exe'), '');

    try {
      expect(discoverWindowsAppPath({
        processName: 'Discord',
        windowsInstallDirs: ['%OPENCLI_TEST_DISCORD_ROOT%'],
      }, {
        OPENCLI_TEST_DISCORD_ROOT: installRoot,
      })).toBe(newerDir);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
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

  it.skipIf(process.platform !== 'win32')('resolves Windows executable names inside the discovered app directory', () => {
    const app: ElectronAppEntry = {
      port: 9232,
      processName: 'Discord',
    };

    expect(resolveExecutableCandidates('C:\\Users\\demo\\AppData\\Local\\Discord\\app-1.0.10', app)).toEqual([
      'C:\\Users\\demo\\AppData\\Local\\Discord\\app-1.0.10\\Discord.exe',
    ]);
  });
});

describe.skipIf(process.platform !== 'win32')('Windows app-scoped process management', () => {
  const appPath = 'C:\\Users\\demo\\AppData\\Local\\Discord\\app-1.0.10';
  const discordApp: ElectronAppEntry = {
    port: 9232,
    processName: 'Discord',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    cp.execFileSync.mockReset();
    cp.spawn.mockReset();
    tui.confirmPrompt.mockReset();
  });

  it('matches only processes whose executable belongs to the discovered app directory', () => {
    cp.execFileSync.mockImplementation((command) => {
      if (command !== 'powershell.exe') throw new Error(`unexpected command ${String(command)}`);
      return JSON.stringify([
        { ProcessId: 101, ExecutablePath: `${appPath}\\Discord.exe`, CommandLine: `"${appPath}\\Discord.exe"` },
        { ProcessId: 202, ExecutablePath: 'C:\\Other\\Discord.exe', CommandLine: '"C:\\Other\\Discord.exe"' },
      ]);
    });

    expect(findAppProcessPids(appPath, discordApp)).toEqual([101]);
  });

  it('requires an executable boundary when falling back to the command line', () => {
    cp.execFileSync.mockImplementation((command) => {
      if (command !== 'powershell.exe') throw new Error(`unexpected command ${String(command)}`);
      return JSON.stringify([
        { ProcessId: 303, ExecutablePath: null, CommandLine: `"${appPath}\\Discord.exe" --type=renderer` },
        { ProcessId: 404, ExecutablePath: null, CommandLine: `"${appPath}\\Discord.exe.backup" --type=renderer` },
        { ProcessId: 405, ExecutablePath: null, CommandLine: `"${appPath}\\Discord.exe"unexpected` },
      ]);
    });

    expect(findAppProcessPids(appPath, discordApp)).toEqual([303]);
  });

  it('requests a graceful taskkill before considering force', async () => {
    let running = true;
    cp.execFileSync.mockImplementation((command, args) => {
      if (command === 'powershell.exe') {
        return running
          ? JSON.stringify([{ ProcessId: 101, ExecutablePath: `${appPath}\\Discord.exe`, CommandLine: null }])
          : '[]';
      }
      if (command === 'taskkill.exe') {
        expect(args).toEqual(['/PID', '101', '/T']);
        running = false;
        return '';
      }
      throw new Error(`unexpected command ${String(command)}`);
    });

    await killAppProcess(appPath, discordApp);

    expect(cp.execFileSync).toHaveBeenCalledWith(
      'taskkill.exe',
      ['/PID', '101', '/T'],
      { stdio: 'pipe', timeout: 5_000 },
    );
  });

  it('defaults restart confirmation to no and leaves the running app untouched', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-discord-confirm-'));
    const appDir = path.join(tempDir, 'app-1.0.10');
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, 'Discord.exe'), '');

    const portServer = createServer();
    await new Promise<void>((resolve) => portServer.listen(0, '127.0.0.1', resolve));
    const address = portServer.address();
    if (!address || typeof address === 'string') throw new Error('Test server did not expose a TCP port');
    await new Promise<void>((resolve, reject) => portServer.close((error) => error ? reject(error) : resolve()));

    const app = getElectronApp('discord-app');
    if (!app) throw new Error('Discord app is not registered');
    const original = {
      ...app,
      windowsInstallDirs: app.windowsInstallDirs ? [...app.windowsInstallDirs] : undefined,
      cdpHosts: app.cdpHosts ? [...app.cdpHosts] : undefined,
    };

    Object.assign(app, {
      port: address.port,
      processName: 'Discord',
      displayName: 'Discord',
      windowsInstallDirs: [tempDir],
      cdpHosts: ['discord.com'],
    });
    cp.execFileSync.mockImplementation((command) => {
      if (command === 'powershell.exe') {
        return JSON.stringify([{
          ProcessId: 101,
          ExecutablePath: `${appDir}\\Discord.exe`,
          CommandLine: `"${appDir}\\Discord.exe"`,
        }]);
      }
      throw new Error(`unexpected command ${String(command)}`);
    });
    tui.confirmPrompt.mockResolvedValue(false);

    try {
      await expect(resolveElectronEndpoint('discord-app')).rejects.toThrow('needs to be restarted');
      expect(tui.confirmPrompt).toHaveBeenCalledWith(
        'Discord is running but CDP is not enabled. Restart with debug port?',
        false,
      );
      expect(cp.spawn).not.toHaveBeenCalled();
      expect(cp.execFileSync.mock.calls.some(([command]) => command === 'taskkill.exe')).toBe(false);
    } finally {
      Object.assign(app, original);
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe.skipIf(process.platform === 'win32')('app-scoped process detection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    cp.execFileSync.mockReset();
  });

  const codexApp: ElectronAppEntry = {
    port: 9238,
    processName: 'Codex',
    executableNames: ['ChatGPT', 'Codex'],
  };

  function mockProcessTable(rows: Record<string, Array<{ pid: number; command: string }>>): void {
    cp.execFileSync.mockImplementation((command, args) => {
      const argv = args as string[];
      if (command === 'pgrep') {
        const processName = argv[1];
        const pids = rows[processName]?.map((row) => row.pid) ?? [];
        if (pids.length === 0) {
          const err = new Error('exit 1') as Error & { status: number };
          err.status = 1;
          throw err;
        }
        return `${pids.join('\n')}\n`;
      }

      if (command === 'ps') {
        const pid = Number.parseInt(argv[1], 10);
        const row = Object.values(rows).flat().find((entry) => entry.pid === pid);
        if (!row) throw new Error('process not found');
        return `${row.command}\n`;
      }

      throw new Error(`unexpected command ${String(command)}`);
    });
  }

  it('detects Codex when only the ChatGPT executable is running inside Codex.app', () => {
    mockProcessTable({
      ChatGPT: [{ pid: 101, command: '/Applications/Codex.app/Contents/MacOS/ChatGPT --remote-debugging-port=9238' }],
    });

    expect(detectAppProcess('/Applications/Codex.app', codexApp)).toBe(true);
  });

  it('detects Codex when only the legacy Codex executable is running', () => {
    mockProcessTable({
      Codex: [{ pid: 102, command: '/Applications/Codex.app/Contents/MacOS/Codex --remote-debugging-port=9238' }],
    });

    expect(detectAppProcess('/Applications/Codex.app', codexApp)).toBe(true);
  });

  it('returns both matching pids when both executable names are running in Codex.app', () => {
    mockProcessTable({
      ChatGPT: [{ pid: 101, command: '/Applications/Codex.app/Contents/MacOS/ChatGPT --remote-debugging-port=9238' }],
      Codex: [{ pid: 102, command: '/Applications/Codex.app/Contents/MacOS/Codex --remote-debugging-port=9238' }],
    });

    expect(findAppProcessPids('/Applications/Codex.app', codexApp)).toEqual([101, 102]);
  });

  it('does not treat the separate ChatGPT desktop app as a running Codex process', () => {
    mockProcessTable({
      ChatGPT: [{ pid: 201, command: '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT --remote-debugging-port=9236' }],
    });

    expect(detectAppProcess('/Applications/FakeCodex.app', codexApp)).toBe(false);
  });

  it('detects Codex when the app path is a symlink but ps reports the resolved executable path', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-launcher-'));
    const realAppPath = path.join(tmp, 'ChatGPT.app');
    const linkAppPath = path.join(tmp, 'Codex.app');
    fs.mkdirSync(path.join(realAppPath, 'Contents', 'MacOS'), { recursive: true });
    fs.symlinkSync(realAppPath, linkAppPath);
    const resolvedAppPath = fs.realpathSync(linkAppPath);
    mockProcessTable({
      ChatGPT: [{ pid: 101, command: `${resolvedAppPath}/Contents/MacOS/ChatGPT --remote-debugging-port=9238` }],
    });

    try {
      expect(detectAppProcess(linkAppPath, codexApp)).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('kills only executable pids scoped to the target app bundle', async () => {
    mockProcessTable({
      ChatGPT: [
        { pid: 101, command: '/Applications/FakeCodex.app/Contents/MacOS/ChatGPT' },
        { pid: 201, command: '/Applications/ChatGPT.app/Contents/MacOS/ChatGPT' },
      ],
    });
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (signal === 0) {
        const err = new Error('missing') as NodeJS.ErrnoException;
        err.code = 'ESRCH';
        throw err;
      }
      return true;
    });

    await killAppProcess('/Applications/FakeCodex.app', codexApp);

    expect(killSpy).toHaveBeenCalledWith(101, 'SIGTERM');
    expect(killSpy).not.toHaveBeenCalledWith(201, 'SIGTERM');
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

  it('does not fall back to the next executable when the first candidate fails for a non-ENOENT reason', async () => {
    const firstChild = createMockChildProcess();
    const app: ElectronAppEntry = {
      port: 9238,
      processName: 'Codex',
      executableNames: ['ChatGPT', 'Codex'],
    };

    cp.spawn.mockImplementationOnce(() => {
      queueMicrotask(() => firstChild.emit('error', Object.assign(new Error('permission denied'), { code: 'EACCES' })));
      return firstChild as unknown as ReturnType<typeof cp.spawn>;
    });

    await expect(
      launchElectronApp('/Applications/Codex.app', app, ['--remote-debugging-port=9238'], 'Codex'),
    ).rejects.toThrow('Failed to launch Codex');

    expect(cp.spawn).toHaveBeenCalledTimes(1);
  });

  it('throws a typed all-candidates-missing error when every executable candidate is absent', async () => {
    const firstChild = createMockChildProcess();
    const secondChild = createMockChildProcess();
    const app: ElectronAppEntry = {
      port: 9238,
      processName: 'Codex',
      executableNames: ['ChatGPT', 'Codex'],
    };

    cp.spawn
      .mockImplementationOnce(() => {
        queueMicrotask(() => firstChild.emit('error', Object.assign(new Error('missing ChatGPT'), { code: 'ENOENT' })));
        return firstChild as unknown as ReturnType<typeof cp.spawn>;
      })
      .mockImplementationOnce(() => {
        queueMicrotask(() => secondChild.emit('error', Object.assign(new Error('missing Codex'), { code: 'ENOENT' })));
        return secondChild as unknown as ReturnType<typeof cp.spawn>;
      });

    await expect(
      launchElectronApp('/Applications/MissingCodex.app', app, ['--remote-debugging-port=9238'], 'Codex'),
    ).rejects.toThrow('Could not launch Codex: no compatible executable found');

    expect(cp.spawn).toHaveBeenCalledTimes(2);
  });
});
