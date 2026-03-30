import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockExecFileSync, mockPlatform, mockHomedir } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
  mockPlatform: vi.fn(() => 'darwin'),
  mockHomedir: vi.fn(() => '/tmp'),
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
    homedir: mockHomedir,
  };
});

import { installExternalCli, parseCommand, type ExternalCliConfig } from './external.js';

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
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-external-test-'));
    mockHomedir.mockReturnValue(tempHome);
  });

  afterEach(() => {
    fs.rmSync(mockHomedir(), { recursive: true, force: true });
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

  it('uses the real package spec when isolated install rewrites npm commands', () => {
    const larkCli: ExternalCliConfig = {
      name: 'lark-cli',
      binary: 'lark-cli',
      install: {
        default: 'npm install -g @larksuite/cli',
      },
    };

    expect(installExternalCli(larkCli, { isolated: true, version: '1.2.3' })).toBe(true);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'npm',
      ['install', '@larksuite/cli@1.2.3', '--prefix', expect.stringContaining(path.join('.opencli', 'opt', 'lark-cli', '1.2.3'))],
      { stdio: 'inherit' },
    );
  });

  it('rejects isolated install for unsupported package managers instead of creating fake isolated state', () => {
    const ghCli: ExternalCliConfig = {
      name: 'gh',
      binary: 'gh',
      install: {
        mac: 'brew install gh',
      },
    };

    expect(installExternalCli(ghCli, { isolated: true })).toBe(false);
    expect(mockExecFileSync).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(mockHomedir(), '.opencli', 'external.lock.json'))).toBe(false);
  });
});
