import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const { mockExecFileSync, mockPlatform } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
  mockPlatform: vi.fn(() => 'darwin'),
}));

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
  execFileSync: mockExecFileSync,
}));

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    platform: mockPlatform,
  };
});

import { formatExternalCliLabel, installExternalCli, parseCommand, type ExternalCliConfig } from './external.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('parseCommand', () => {
  it('splits binaries and quoted arguments without invoking a shell', () => {
    expect(parseCommand('npm install -g "@scope/tool name"')).toEqual({
      binary: 'npm',
      args: ['install', '-g', '@scope/tool name'],
    });
  });

  it('rejects shell operators', () => {
    expect(() => parseCommand('brew install gh && rm -rf /')).toThrow(
      'Install command contains unsafe shell operators',
    );
  });

  it('rejects command substitution and multiline input', () => {
    expect(() => parseCommand('brew install $(whoami)')).toThrow(
      'Install command contains unsafe shell operators',
    );
    expect(() => parseCommand('brew install gh\nrm -rf /')).toThrow(
      'Install command contains unsafe shell operators',
    );
  });

  it('keeps built-in install commands compatible with the shell-free parser', () => {
    const raw = fs.readFileSync(path.join(__dirname, 'external-clis.yaml'), 'utf8');
    const entries = (yaml.load(raw) || []) as ExternalCliConfig[];

    for (const entry of entries) {
      for (const command of Object.values(entry.install ?? {})) {
        if (command) expect(() => parseCommand(command)).not.toThrow();
      }
    }
  });

  it('registers Longbridge with safe package-manager installers only', () => {
    const raw = fs.readFileSync(path.join(__dirname, 'external-clis.yaml'), 'utf8');
    const entries = (yaml.load(raw) || []) as ExternalCliConfig[];
    const longbridge = entries.find((entry) => entry.name === 'longbridge');

    expect(longbridge).toMatchObject({
      binary: 'longbridge',
      homepage: 'https://open.longbridge.com/zh-CN/docs/cli/',
      install: {
        mac: 'brew install --cask longbridge/tap/longbridge-terminal',
        windows: 'scoop install https://open.longbridge.com/longbridge/longbridge-terminal/longbridge.json',
      },
    });
    expect(longbridge?.install?.linux).toBeUndefined();
    expect(longbridge?.install?.default).toBeUndefined();
  });
});

describe('formatExternalCliLabel', () => {
  it('shows the package name when the executable name differs', () => {
    expect(formatExternalCliLabel({ name: 'wx', binary: 'wx', package: 'wx-cli' })).toBe('wx(wx-cli)');
  });

  it('keeps the label compact when package and name match', () => {
    expect(formatExternalCliLabel({ name: 'docker', binary: 'docker', package: 'docker' })).toBe('docker');
  });
});

describe('installExternalCli', () => {
  const cli: ExternalCliConfig = {
    name: 'readwise',
    binary: 'readwise',
    install: {
      default: 'npm install -g @readwiseio/readwise-cli',
    },
  };

  beforeEach(() => {
    mockExecFileSync.mockReset();
    mockPlatform.mockReturnValue('darwin');
  });

  it('retries with .cmd on Windows when the bare binary is unavailable', () => {
    mockPlatform.mockReturnValue('win32');
    mockExecFileSync
      .mockImplementationOnce(() => {
        const err = new Error('not found') as NodeJS.ErrnoException;
        err.code = 'ENOENT';
        throw err;
      })
      .mockReturnValueOnce(Buffer.from(''));

    expect(installExternalCli(cli)).toBe(true);
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      1,
      'npm',
      ['install', '-g', '@readwiseio/readwise-cli'],
      { stdio: 'inherit' },
    );
    expect(mockExecFileSync).toHaveBeenNthCalledWith(
      2,
      'npm.cmd',
      ['install', '-g', '@readwiseio/readwise-cli'],
      { stdio: 'inherit' },
    );
  });

  it('does not mask non-ENOENT failures', () => {
    mockPlatform.mockReturnValue('win32');
    mockExecFileSync.mockImplementationOnce(() => {
      const err = new Error('permission denied') as NodeJS.ErrnoException;
      err.code = 'EACCES';
      throw err;
    });

    expect(installExternalCli(cli)).toBe(false);
    expect(mockExecFileSync).toHaveBeenCalledTimes(1);
  });
});
