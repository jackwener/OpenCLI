/**
 * Tests for plugin management: install, uninstall, list, and lock file support.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PLUGINS_DIR } from './discovery.js';
import type { LockEntry } from './plugin.js';
import * as pluginModule from './plugin.js';

const { mockExecFileSync, mockExecSync } = vi.hoisted(() => ({
  mockExecFileSync: vi.fn(),
  mockExecSync: vi.fn(),
}));

const {
  _getCommitHash,
  _installDependencies,
  _postInstallMonorepoLifecycle,
  _promoteDir,
  _replaceDir,
  installPlugin,
  listPlugins,
  _readLockFile,
  _resolveEsbuildBin,
  uninstallPlugin,
  updatePlugin,
  _parseSource,
  _updateAllPlugins,
  _validatePluginStructure,
  _writeLockFile,
  _isSymlinkSync,
  _getMonoreposDir,
  getLockFilePath,
  _installLocalPlugin,
  _isLocalPluginSource,
  _moveDir,
  _resolveStoredPluginSource,
  _toLocalPluginSource,
} = pluginModule;

describe('parseSource', () => {
  it('parses github:user/repo format', () => {
    const result = _parseSource('github:ByteYue/opencli-plugin-github-trending');
    expect(result).toEqual({
      type: 'git',
      cloneUrl: 'https://github.com/ByteYue/opencli-plugin-github-trending.git',
      name: 'github-trending',
    });
  });

  it('parses https URL format', () => {
    const result = _parseSource('https://github.com/ByteYue/opencli-plugin-hot-digest');
    expect(result).toEqual({
      type: 'git',
      cloneUrl: 'https://github.com/ByteYue/opencli-plugin-hot-digest.git',
      name: 'hot-digest',
    });
  });

  it('strips opencli-plugin- prefix from name', () => {
    const result = _parseSource('github:user/opencli-plugin-my-tool');
    expect(result!.name).toBe('my-tool');
  });

  it('keeps name without prefix', () => {
    const result = _parseSource('github:user/awesome-cli');
    expect(result!.name).toBe('awesome-cli');
  });

  it('returns null for invalid source', () => {
    expect(_parseSource('invalid')).toBeNull();
    expect(_parseSource('npm:some-package')).toBeNull();
  });

  it('parses file:// local plugin directories', () => {
    const localDir = path.join(os.tmpdir(), 'opencli-plugin-test');
    const fileUrl = pathToFileURL(localDir).href;
    const result = _parseSource(fileUrl);
    expect(result).toEqual({
      type: 'local',
      localPath: localDir,
      name: 'test',
    });
  });

  it('parses plain absolute local plugin directories', () => {
    const localDir = path.join(os.tmpdir(), 'my-plugin');
    const result = _parseSource(localDir);
    expect(result).toEqual({
      type: 'local',
      localPath: localDir,
      name: 'my-plugin',
    });
  });

  it('strips opencli-plugin- prefix for local paths', () => {
    const localDir = path.join(os.tmpdir(), 'opencli-plugin-foo');
    const result = _parseSource(localDir);
    expect(result!.name).toBe('foo');
  });

  // ── Generic git URL support ──
  it('parses ssh:// URLs', () => {
    const result = _parseSource('ssh://git@gitlab.com/team/opencli-plugin-tools.git');
    expect(result).toEqual({
      type: 'git',
      cloneUrl: 'ssh://git@gitlab.com/team/opencli-plugin-tools.git',
      name: 'tools',
    });
  });

  it('parses ssh:// URLs without .git suffix', () => {
    const result = _parseSource('ssh://git@gitlab.com/team/my-plugin');
    expect(result).toEqual({
      type: 'git',
      cloneUrl: 'ssh://git@gitlab.com/team/my-plugin',
      name: 'my-plugin',
    });
  });

  it('parses git@ SCP-style URLs', () => {
    const result = _parseSource('git@gitlab.com:team/my-plugin.git');
    expect(result).toEqual({
      type: 'git',
      cloneUrl: 'git@gitlab.com:team/my-plugin.git',
      name: 'my-plugin',
    });
  });

  it('parses git@ SCP-style URLs and strips opencli-plugin- prefix', () => {
    const result = _parseSource('git@github.com:user/opencli-plugin-awesome.git');
    expect(result).toEqual({
      type: 'git',
      cloneUrl: 'git@github.com:user/opencli-plugin-awesome.git',
      name: 'awesome',
    });
  });

  it('parses generic HTTPS git URLs (non-GitHub)', () => {
    const result = _parseSource('https://codehub.example.com/Team/App/opencli-plugins-app.git');
    expect(result).toEqual({
      type: 'git',
      cloneUrl: 'https://codehub.example.com/Team/App/opencli-plugins-app.git',
      name: 'opencli-plugins-app',
    });
  });

  it('parses generic HTTPS git URLs without .git suffix', () => {
    const result = _parseSource('https://gitlab.example.com/org/my-plugin');
    expect(result).toEqual({
      type: 'git',
      cloneUrl: 'https://gitlab.example.com/org/my-plugin.git',
      name: 'my-plugin',
    });
  });

  it('still prefers GitHub shorthand over generic HTTPS for github.com', () => {
    const result = _parseSource('https://github.com/user/repo');
    // Should be handled by the GitHub-specific matcher (normalizes URL)
    expect(result).toEqual({
      type: 'git',
      cloneUrl: 'https://github.com/user/repo.git',
      name: 'repo',
    });
  });
});

describe('validatePluginStructure', () => {
  const testDir = path.join(PLUGINS_DIR, '__test-validate__');

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true }); } catch {}
  });

  it('returns invalid for non-existent directory', () => {
    const res = _validatePluginStructure(path.join(PLUGINS_DIR, '__does_not_exist__'));
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toContain('does not exist');
  });

  it('returns invalid for empty directory', () => {
    const res = _validatePluginStructure(testDir);
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toContain('No command files found');
  });

  it('returns valid for YAML plugin', () => {
    fs.writeFileSync(path.join(testDir, 'cmd.yaml'), 'site: test');
    const res = _validatePluginStructure(testDir);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('returns valid for JS plugin', () => {
    fs.writeFileSync(path.join(testDir, 'cmd.js'), 'console.log("hi");');
    const res = _validatePluginStructure(testDir);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('returns invalid for TS plugin without package.json', () => {
    fs.writeFileSync(path.join(testDir, 'cmd.ts'), 'console.log("hi");');
    const res = _validatePluginStructure(testDir);
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toContain('contains .ts files but no package.json');
  });

  it('returns invalid for TS plugin with missing type: module', () => {
    fs.writeFileSync(path.join(testDir, 'cmd.ts'), 'console.log("hi");');
    fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({ name: 'test' }));
    const res = _validatePluginStructure(testDir);
    expect(res.valid).toBe(false);
    expect(res.errors[0]).toContain('must have "type": "module"');
  });

  it('returns valid for TS plugin with correct package.json', () => {
    fs.writeFileSync(path.join(testDir, 'cmd.ts'), 'console.log("hi");');
    fs.writeFileSync(path.join(testDir, 'package.json'), JSON.stringify({ type: 'module' }));
    const res = _validatePluginStructure(testDir);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });
});

describe('lock file', () => {
  const backupPath = `${getLockFilePath()}.test-backup`;
  let hadOriginal = false;

  beforeEach(() => {
    hadOriginal = fs.existsSync(getLockFilePath());
    if (hadOriginal) {
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.copyFileSync(getLockFilePath(), backupPath);
    }
  });

  afterEach(() => {
    if (hadOriginal) {
      fs.copyFileSync(backupPath, getLockFilePath());
      fs.unlinkSync(backupPath);
      return;
    }
    try { fs.unlinkSync(getLockFilePath()); } catch {}
  });

  it('reads empty lock when file does not exist', () => {
    try { fs.unlinkSync(getLockFilePath()); } catch {}
    expect(_readLockFile()).toEqual({});
  });

  it('round-trips lock entries', () => {
    const entries: Record<string, LockEntry> = {
      'test-plugin': {
        source: 'https://github.com/user/repo.git',
        commitHash: 'abc1234567890def',
        installedAt: '2025-01-01T00:00:00.000Z',
      },
      'another-plugin': {
        source: 'https://github.com/user/another.git',
        commitHash: 'def4567890123abc',
        installedAt: '2025-02-01T00:00:00.000Z',
        updatedAt: '2025-03-01T00:00:00.000Z',
      },
    };

    _writeLockFile(entries);
    expect(_readLockFile()).toEqual(entries);
  });

  it('handles malformed lock file gracefully', () => {
    fs.mkdirSync(path.dirname(getLockFilePath()), { recursive: true });
    fs.writeFileSync(getLockFilePath(), 'not valid json');
    expect(_readLockFile()).toEqual({});
  });
});

describe('getCommitHash', () => {
  it('returns a hash for a git repo', () => {
    const hash = _getCommitHash(process.cwd());
    expect(hash).toBeDefined();
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
  });

  it('returns undefined for non-git directory', () => {
    expect(_getCommitHash(os.tmpdir())).toBeUndefined();
  });
});

describe('resolveEsbuildBin', () => {
  it('resolves a usable esbuild executable path', () => {
    const binPath = _resolveEsbuildBin();
    expect(binPath).not.toBeNull();
    expect(typeof binPath).toBe('string');
    expect(fs.existsSync(binPath!)).toBe(true);
    expect(binPath).toMatch(/esbuild(\.cmd)?$/);
  });
});

describe('listPlugins', () => {
  const testDir = path.join(PLUGINS_DIR, '__test-list-plugin__');

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true }); } catch {}
  });

  it('lists installed plugins', () => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'hello.yaml'), 'site: test\nname: hello\n');

    const plugins = listPlugins();
    const found = plugins.find(p => p.name === '__test-list-plugin__');
    expect(found).toBeDefined();
    expect(found!.commands).toContain('hello');
  });

  it('includes version metadata from the lock file', () => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'hello.yaml'), 'site: test\nname: hello\n');

    const lock = _readLockFile();
    lock['__test-list-plugin__'] = {
      source: 'https://github.com/user/repo.git',
      commitHash: 'abcdef1234567890abcdef1234567890abcdef12',
      installedAt: '2025-01-01T00:00:00.000Z',
    };
    _writeLockFile(lock);

    const plugins = listPlugins();
    const found = plugins.find(p => p.name === '__test-list-plugin__');
    expect(found).toBeDefined();
    expect(found!.version).toBe('abcdef1');
    expect(found!.installedAt).toBe('2025-01-01T00:00:00.000Z');

    delete lock['__test-list-plugin__'];
    _writeLockFile(lock);
  });

  it('returns empty array when no plugins dir', () => {
    const plugins = listPlugins();
    expect(Array.isArray(plugins)).toBe(true);
  });

  it('prefers lockfile source for local symlink plugins', () => {
    const localTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-local-list-'));
    const linkPath = path.join(PLUGINS_DIR, '__test-list-plugin__');

    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    fs.writeFileSync(path.join(localTarget, 'hello.yaml'), 'site: test\nname: hello\n');
    fs.symlinkSync(localTarget, linkPath, 'dir');

    const lock = _readLockFile();
    lock['__test-list-plugin__'] = {
      source: `local:${localTarget}`,
      commitHash: 'local',
      installedAt: '2025-01-01T00:00:00.000Z',
    };
    _writeLockFile(lock);

    const plugins = listPlugins();
    const found = plugins.find(p => p.name === '__test-list-plugin__');
    expect(found?.source).toBe(`local:${localTarget}`);

    try { fs.unlinkSync(linkPath); } catch {}
    try { fs.rmSync(localTarget, { recursive: true, force: true }); } catch {}
    delete lock['__test-list-plugin__'];
    _writeLockFile(lock);
  });
});

describe('uninstallPlugin', () => {
  const testDir = path.join(PLUGINS_DIR, '__test-uninstall__');

  afterEach(() => {
    try { fs.rmSync(testDir, { recursive: true }); } catch {}
  });

  it('removes plugin directory', () => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'test.yaml'), 'site: test');

    uninstallPlugin('__test-uninstall__');
    expect(fs.existsSync(testDir)).toBe(false);
  });

  it('removes lock entry on uninstall', () => {
    fs.mkdirSync(testDir, { recursive: true });
    fs.writeFileSync(path.join(testDir, 'test.yaml'), 'site: test');

    const lock = _readLockFile();
    lock['__test-uninstall__'] = {
      source: 'https://github.com/user/repo.git',
      commitHash: 'abc123',
      installedAt: '2025-01-01T00:00:00.000Z',
    };
    _writeLockFile(lock);

    uninstallPlugin('__test-uninstall__');
    expect(_readLockFile()['__test-uninstall__']).toBeUndefined();
  });

  it('throws for non-existent plugin', () => {
    expect(() => uninstallPlugin('__nonexistent__')).toThrow('not installed');
  });
});

describe('updatePlugin', () => {
  it('throws for non-existent plugin', () => {
    expect(() => updatePlugin('__nonexistent__')).toThrow('not installed');
  });

  it('refreshes local plugins without running git pull', () => {
    const localTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-local-update-'));
    const linkPath = path.join(PLUGINS_DIR, '__test-local-update__');

    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    fs.writeFileSync(path.join(localTarget, 'hello.yaml'), 'site: test\nname: hello\n');
    fs.symlinkSync(localTarget, linkPath, 'dir');

    const lock = _readLockFile();
    lock['__test-local-update__'] = {
      source: `local:${localTarget}`,
      commitHash: 'local',
      installedAt: '2025-01-01T00:00:00.000Z',
    };
    _writeLockFile(lock);

    mockExecFileSync.mockClear();
    updatePlugin('__test-local-update__');

    expect(
      mockExecFileSync.mock.calls.some(
        ([cmd, args, opts]) => cmd === 'git'
          && Array.isArray(args)
          && args[0] === 'pull'
          && opts?.cwd === linkPath,
      ),
    ).toBe(false);

    const updated = _readLockFile()['__test-local-update__'];
    expect(updated?.source).toBe(`local:${localTarget}`);
    expect(updated?.updatedAt).toBeDefined();

    try { fs.unlinkSync(linkPath); } catch {}
    try { fs.rmSync(localTarget, { recursive: true, force: true }); } catch {}
    const finalLock = _readLockFile();
    delete finalLock['__test-local-update__'];
    _writeLockFile(finalLock);
  });
});

vi.mock('node:child_process', () => {
  return {
    execFileSync: mockExecFileSync.mockImplementation((_cmd, args, opts) => {
      if (Array.isArray(args) && args[0] === 'rev-parse' && args[1] === 'HEAD') {
        if (opts?.cwd === os.tmpdir()) {
          throw new Error('not a git repository');
        }
        return '1234567890abcdef1234567890abcdef12345678\n';
      }
      if (opts && opts.cwd && String(opts.cwd).endsWith('plugin-b')) {
        throw new Error('Network error');
      }
      return '';
    }),
    execSync: mockExecSync.mockImplementation(() => ''),
  };
});

describe('installDependencies', () => {
  beforeEach(() => {
    mockExecFileSync.mockClear();
    mockExecSync.mockClear();
  });

  it('throws when npm install fails', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-plugin-b-'));
    const failingDir = path.join(tmpDir, 'plugin-b');
    fs.mkdirSync(failingDir, { recursive: true });
    fs.writeFileSync(path.join(failingDir, 'package.json'), JSON.stringify({ name: 'plugin-b' }));

    expect(() => _installDependencies(failingDir)).toThrow('npm install failed');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe('postInstallMonorepoLifecycle', () => {
  let repoDir: string;
  let subDir: string;

  beforeEach(() => {
    mockExecFileSync.mockClear();
    mockExecSync.mockClear();
    repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-monorepo-'));
    subDir = path.join(repoDir, 'packages', 'alpha');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({
      name: 'opencli-plugins',
      private: true,
      workspaces: ['packages/*'],
    }));
    fs.writeFileSync(path.join(subDir, 'hello.yaml'), 'site: test\nname: hello\n');
  });

  afterEach(() => {
    fs.rmSync(repoDir, { recursive: true, force: true });
  });

  it('installs dependencies once at the monorepo root, not in each sub-plugin', () => {
    _postInstallMonorepoLifecycle(repoDir, [subDir]);

    const npmCalls = mockExecFileSync.mock.calls.filter(
      ([cmd, args]) => cmd === 'npm' && Array.isArray(args) && args[0] === 'install',
    );

    expect(npmCalls).toHaveLength(1);
    expect(npmCalls[0][2]).toMatchObject({ cwd: repoDir });
    expect(npmCalls.some(([, , opts]) => opts?.cwd === subDir)).toBe(false);
  });
});

describe('updateAllPlugins', () => {
  const testDirA = path.join(PLUGINS_DIR, 'plugin-a');
  const testDirB = path.join(PLUGINS_DIR, 'plugin-b');
  const testDirC = path.join(PLUGINS_DIR, 'plugin-c');

  beforeEach(() => {
    fs.mkdirSync(testDirA, { recursive: true });
    fs.mkdirSync(testDirB, { recursive: true });
    fs.mkdirSync(testDirC, { recursive: true });
    fs.writeFileSync(path.join(testDirA, 'cmd.yaml'), 'site: a');
    fs.writeFileSync(path.join(testDirB, 'cmd.yaml'), 'site: b');
    fs.writeFileSync(path.join(testDirC, 'cmd.yaml'), 'site: c');

    const lock = _readLockFile();
    lock['plugin-a'] = {
      source: 'https://github.com/user/plugin-a.git',
      commitHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      installedAt: '2025-01-01T00:00:00.000Z',
    };
    lock['plugin-b'] = {
      source: 'https://github.com/user/plugin-b.git',
      commitHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      installedAt: '2025-01-01T00:00:00.000Z',
    };
    lock['plugin-c'] = {
      source: 'https://github.com/user/plugin-c.git',
      commitHash: 'cccccccccccccccccccccccccccccccccccccccc',
      installedAt: '2025-01-01T00:00:00.000Z',
    };
    _writeLockFile(lock);
  });

  afterEach(() => {
    try { fs.rmSync(testDirA, { recursive: true }); } catch {}
    try { fs.rmSync(testDirB, { recursive: true }); } catch {}
    try { fs.rmSync(testDirC, { recursive: true }); } catch {}
    const lock = _readLockFile();
    delete lock['plugin-a'];
    delete lock['plugin-b'];
    delete lock['plugin-c'];
    _writeLockFile(lock);
    vi.clearAllMocks();
  });

  it('collects successes and failures without throwing', () => {
    mockExecFileSync.mockImplementation((cmd, args) => {
      if (cmd === 'git' && Array.isArray(args) && args[0] === 'clone') {
        const cloneUrl = String(args[3]);
        const cloneDir = String(args[4]);
        fs.mkdirSync(cloneDir, { recursive: true });
        fs.writeFileSync(path.join(cloneDir, 'cmd.yaml'), 'site: test\nname: hello\n');
        if (cloneUrl.includes('plugin-b')) {
          fs.writeFileSync(path.join(cloneDir, 'package.json'), JSON.stringify({ name: 'plugin-b' }));
        }
        return '';
      }
      if (cmd === 'npm' && Array.isArray(args) && args[0] === 'install') {
        throw new Error('Network error');
      }
      if (cmd === 'git' && Array.isArray(args) && args[0] === 'rev-parse' && args[1] === 'HEAD') {
        return '1234567890abcdef1234567890abcdef12345678\n';
      }
      return '';
    });

    const results = _updateAllPlugins();

    const resA = results.find(r => r.name === 'plugin-a');
    const resB = results.find(r => r.name === 'plugin-b');
    const resC = results.find(r => r.name === 'plugin-c');

    expect(resA).toBeDefined();
    expect(resA!.success).toBe(true);

    expect(resB).toBeDefined();
    expect(resB!.success).toBe(false);
    expect(resB!.error).toContain('Network error');

    expect(resC).toBeDefined();
    expect(resC!.success).toBe(true);
  });
});

// ── Monorepo-specific tests ─────────────────────────────────────────────────

describe('parseSource with monorepo subplugin', () => {
  it('parses github:user/repo/subplugin format', () => {
    const result = _parseSource('github:ByteYue/opencli-plugins/polymarket');
    expect(result).toEqual({
      type: 'git',
      cloneUrl: 'https://github.com/ByteYue/opencli-plugins.git',
      name: 'opencli-plugins',
      subPlugin: 'polymarket',
    });
  });

  it('strips opencli-plugin- prefix from repo name in subplugin format', () => {
    const result = _parseSource('github:user/opencli-plugin-collection/defi');
    expect(result!.name).toBe('collection');
    expect(result!.subPlugin).toBe('defi');
  });

  it('still parses github:user/repo without subplugin', () => {
    const result = _parseSource('github:user/my-repo');
    expect(result).toEqual({
      type: 'git',
      cloneUrl: 'https://github.com/user/my-repo.git',
      name: 'my-repo',
    });
    expect(result!.subPlugin).toBeUndefined();
  });
});

describe('isSymlinkSync', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-symlink-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns false for a regular directory', () => {
    const dir = path.join(tmpDir, 'regular');
    fs.mkdirSync(dir);
    expect(_isSymlinkSync(dir)).toBe(false);
  });

  it('returns true for a symlink', () => {
    const target = path.join(tmpDir, 'target');
    const link = path.join(tmpDir, 'link');
    fs.mkdirSync(target);
    fs.symlinkSync(target, link, 'dir');
    expect(_isSymlinkSync(link)).toBe(true);
  });

  it('returns false for non-existent path', () => {
    expect(_isSymlinkSync(path.join(tmpDir, 'nope'))).toBe(false);
  });
});

describe('monorepo uninstall with symlink', () => {
  let tmpDir: string;
  let pluginDir: string;
  let monoDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-mono-uninstall-'));
    pluginDir = path.join(PLUGINS_DIR, '__test-mono-sub__');
    monoDir = path.join(_getMonoreposDir(), '__test-mono__');

    const subDir = path.join(monoDir, 'packages', 'sub');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'cmd.yaml'), 'site: test');

    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    fs.symlinkSync(subDir, pluginDir, 'dir');

    const lock = _readLockFile();
    lock['__test-mono-sub__'] = {
      source: 'https://github.com/user/test.git',
      commitHash: 'abc123',
      installedAt: '2025-01-01T00:00:00.000Z',
      monorepo: { name: '__test-mono__', subPath: 'packages/sub' },
    };
    _writeLockFile(lock);
  });

  afterEach(() => {
    try { fs.unlinkSync(pluginDir); } catch {}
    try { fs.rmSync(pluginDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(monoDir, { recursive: true, force: true }); } catch {}
    const lock = _readLockFile();
    delete lock['__test-mono-sub__'];
    _writeLockFile(lock);
  });

  it('removes symlink but keeps monorepo if other sub-plugins reference it', () => {
    const lock = _readLockFile();
    lock['__test-mono-other__'] = {
      source: 'https://github.com/user/test.git',
      commitHash: 'abc123',
      installedAt: '2025-01-01T00:00:00.000Z',
      monorepo: { name: '__test-mono__', subPath: 'packages/other' },
    };
    _writeLockFile(lock);

    uninstallPlugin('__test-mono-sub__');

    expect(fs.existsSync(pluginDir)).toBe(false);
    expect(fs.existsSync(monoDir)).toBe(true);
    expect(_readLockFile()['__test-mono-sub__']).toBeUndefined();
    expect(_readLockFile()['__test-mono-other__']).toBeDefined();

    const finalLock = _readLockFile();
    delete finalLock['__test-mono-other__'];
    _writeLockFile(finalLock);
  });

  it('removes symlink AND monorepo dir when last sub-plugin is uninstalled', () => {
    uninstallPlugin('__test-mono-sub__');

    expect(fs.existsSync(pluginDir)).toBe(false);
    expect(fs.existsSync(monoDir)).toBe(false);
    expect(_readLockFile()['__test-mono-sub__']).toBeUndefined();
  });
});

describe('listPlugins with monorepo metadata', () => {
  const testSymlinkTarget = path.join(os.tmpdir(), 'opencli-list-mono-target');
  const testLink = path.join(PLUGINS_DIR, '__test-mono-list__');

  beforeEach(() => {
    fs.mkdirSync(testSymlinkTarget, { recursive: true });
    fs.writeFileSync(path.join(testSymlinkTarget, 'hello.yaml'), 'site: test\nname: hello\n');

    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    try { fs.unlinkSync(testLink); } catch {}
    fs.symlinkSync(testSymlinkTarget, testLink, 'dir');

    const lock = _readLockFile();
    lock['__test-mono-list__'] = {
      source: 'https://github.com/user/test-mono.git',
      commitHash: 'def456def456def456def456def456def456def4',
      installedAt: '2025-01-01T00:00:00.000Z',
      monorepo: { name: 'test-mono', subPath: 'packages/list' },
    };
    _writeLockFile(lock);
  });

  afterEach(() => {
    try { fs.unlinkSync(testLink); } catch {}
    try { fs.rmSync(testSymlinkTarget, { recursive: true, force: true }); } catch {}
    const lock = _readLockFile();
    delete lock['__test-mono-list__'];
    _writeLockFile(lock);
  });

  it('lists symlinked plugins with monorepoName', () => {
    const plugins = listPlugins();
    const found = plugins.find(p => p.name === '__test-mono-list__');
    expect(found).toBeDefined();
    expect(found!.monorepoName).toBe('test-mono');
    expect(found!.commands).toContain('hello');
    expect(found!.source).toBe('https://github.com/user/test-mono.git');
  });
});

describe('installLocalPlugin', () => {
  let tmpDir: string;
  const pluginName = '__test-local-plugin__';

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-local-install-'));
    fs.writeFileSync(path.join(tmpDir, 'hello.yaml'), 'site: test\nname: hello\n');
  });

  afterEach(() => {
    const linkPath = path.join(PLUGINS_DIR, pluginName);
    try { fs.unlinkSync(linkPath); } catch {}
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    const lock = _readLockFile();
    delete lock[pluginName];
    _writeLockFile(lock);
  });

  it('creates a symlink to the local directory', () => {
    const result = _installLocalPlugin(tmpDir, pluginName);
    expect(result).toBe(pluginName);
    const linkPath = path.join(PLUGINS_DIR, pluginName);
    expect(fs.existsSync(linkPath)).toBe(true);
    expect(_isSymlinkSync(linkPath)).toBe(true);
  });

  it('records local: source in lockfile', () => {
    _installLocalPlugin(tmpDir, pluginName);
    const lock = _readLockFile();
    expect(lock[pluginName]).toBeDefined();
    expect(lock[pluginName].source).toMatch(/^local:/);
  });

  it('lists the recorded local source', () => {
    _installLocalPlugin(tmpDir, pluginName);
    const plugins = listPlugins();
    const found = plugins.find(p => p.name === pluginName);
    expect(found).toBeDefined();
    expect(found!.source).toBe(`local:${path.resolve(tmpDir)}`);
  });

  it('throws for non-existent path', () => {
    expect(() => _installLocalPlugin('/does/not/exist', 'x')).toThrow('does not exist');
  });
});

describe('isLocalPluginSource', () => {
  it('detects lockfile local sources', () => {
    expect(_isLocalPluginSource('local:/tmp/plugin')).toBe(true);
    expect(_isLocalPluginSource('https://github.com/user/repo.git')).toBe(false);
    expect(_isLocalPluginSource(undefined)).toBe(false);
  });
});

describe('plugin source helpers', () => {
  it('formats local plugin sources consistently', () => {
    const dir = path.join(os.tmpdir(), 'opencli-plugin-source');
    expect(_toLocalPluginSource(dir)).toBe(`local:${path.resolve(dir)}`);
  });

  it('prefers lockfile source over git remote lookup', () => {
    const dir = path.join(os.tmpdir(), 'opencli-plugin-source');
    const source = _resolveStoredPluginSource({
      source: 'local:/tmp/plugin',
      commitHash: 'local',
      installedAt: '2025-01-01T00:00:00.000Z',
    }, dir);
    expect(source).toBe('local:/tmp/plugin');
  });
});

describe('moveDir', () => {
  it('cleans up destination when EXDEV fallback copy fails', () => {
    const src = path.join(os.tmpdir(), 'opencli-move-src');
    const dest = path.join(os.tmpdir(), 'opencli-move-dest');
    const renameErr = Object.assign(new Error('cross-device link not permitted'), { code: 'EXDEV' });
    const copyErr = new Error('copy failed');
    const renameSync = vi.fn(() => { throw renameErr; });
    const cpSync = vi.fn(() => { throw copyErr; });
    const rmSync = vi.fn(() => undefined);

    expect(() => _moveDir(src, dest, { renameSync, cpSync, rmSync })).toThrow(copyErr);
    expect(renameSync).toHaveBeenCalledWith(src, dest);
    expect(cpSync).toHaveBeenCalledWith(src, dest, { recursive: true });
    expect(rmSync).toHaveBeenCalledWith(dest, { recursive: true, force: true });
  });
});

describe('promoteDir', () => {
  it('cleans up temporary publish dir when final rename fails', () => {
    const staging = path.join(os.tmpdir(), 'opencli-promote-stage');
    const dest = path.join(os.tmpdir(), 'opencli-promote-dest');
    const publishErr = new Error('publish failed');
    const existsSync = vi.fn(() => false);
    const mkdirSync = vi.fn(() => undefined);
    const cpSync = vi.fn(() => undefined);
    const rmSync = vi.fn(() => undefined);
    const renameSync = vi.fn((src, _target) => {
      if (String(src) === staging) return;
      throw publishErr;
    });

    expect(() => _promoteDir(staging, dest, { existsSync, mkdirSync, renameSync, cpSync, rmSync })).toThrow(publishErr);

    const tempDest = renameSync.mock.calls[0][1];
    expect(renameSync).toHaveBeenNthCalledWith(1, staging, tempDest);
    expect(renameSync).toHaveBeenNthCalledWith(2, tempDest, dest);
    expect(rmSync).toHaveBeenCalledWith(tempDest, { recursive: true, force: true });
  });
});

describe('replaceDir', () => {
  it('rolls back the original destination when swap fails', () => {
    const staging = path.join(os.tmpdir(), 'opencli-replace-stage');
    const dest = path.join(os.tmpdir(), 'opencli-replace-dest');
    const publishErr = new Error('swap failed');
    const existingPaths = new Set([dest]);
    const existsSync = vi.fn((p) => existingPaths.has(String(p)));
    const mkdirSync = vi.fn(() => undefined);
    const cpSync = vi.fn(() => undefined);
    const rmSync = vi.fn(() => undefined);
    const renameSync = vi.fn((src, target) => {
      if (String(src) === staging) {
        existingPaths.add(String(target));
        return;
      }
      if (String(src) === dest) {
        existingPaths.delete(dest);
        existingPaths.add(String(target));
        return;
      }
      if (String(target) === dest) throw publishErr;
      if (existingPaths.has(String(src))) {
        existingPaths.delete(String(src));
        existingPaths.add(String(target));
      }
    });

    expect(() => _replaceDir(staging, dest, { existsSync, mkdirSync, renameSync, cpSync, rmSync })).toThrow(publishErr);

    const tempDest = renameSync.mock.calls[0][1];
    const backupDest = renameSync.mock.calls[1][1];
    expect(renameSync).toHaveBeenNthCalledWith(1, staging, tempDest);
    expect(renameSync).toHaveBeenNthCalledWith(2, dest, backupDest);
    expect(renameSync).toHaveBeenNthCalledWith(3, tempDest, dest);
    expect(renameSync).toHaveBeenNthCalledWith(4, backupDest, dest);
    expect(rmSync).toHaveBeenCalledWith(tempDest, { recursive: true, force: true });
  });
});

describe('installPlugin transactional staging', () => {
  const standaloneSource = 'github:user/opencli-plugin-__test-transactional-standalone__';
  const standaloneName = '__test-transactional-standalone__';
  const standaloneDir = path.join(PLUGINS_DIR, standaloneName);
  const monorepoSource = 'github:user/opencli-plugins-__test-transactional__';
  const monorepoRepoDir = path.join(_getMonoreposDir(), 'opencli-plugins-__test-transactional__');
  const monorepoLink = path.join(PLUGINS_DIR, 'alpha');

  beforeEach(() => {
    mockExecFileSync.mockClear();
    mockExecSync.mockClear();
  });

  afterEach(() => {
    try { fs.unlinkSync(monorepoLink); } catch {}
    try { fs.rmSync(monorepoLink, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(monorepoRepoDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(standaloneDir, { recursive: true, force: true }); } catch {}
    const lock = _readLockFile();
    delete lock[standaloneName];
    delete lock.alpha;
    _writeLockFile(lock);
    vi.clearAllMocks();
  });

  it('does not expose the final standalone plugin dir when lifecycle fails in staging', () => {
    mockExecFileSync.mockImplementation((cmd, args) => {
      if (cmd === 'git' && Array.isArray(args) && args[0] === 'clone') {
        const cloneDir = String(args[args.length - 1]);
        fs.mkdirSync(cloneDir, { recursive: true });
        fs.writeFileSync(path.join(cloneDir, 'hello.yaml'), 'site: test\nname: hello\n');
        fs.writeFileSync(path.join(cloneDir, 'package.json'), JSON.stringify({ name: standaloneName }));
        return '';
      }
      if (cmd === 'npm' && Array.isArray(args) && args[0] === 'install') {
        throw new Error('boom');
      }
      if (cmd === 'git' && Array.isArray(args) && args[0] === 'rev-parse' && args[1] === 'HEAD') {
        return '1234567890abcdef1234567890abcdef12345678\n';
      }
      return '';
    });

    expect(() => installPlugin(standaloneSource)).toThrow(`npm install failed`);
    expect(fs.existsSync(standaloneDir)).toBe(false);
    expect(_readLockFile()[standaloneName]).toBeUndefined();
  });

  it('does not expose monorepo links or repo dir when lifecycle fails in staging', () => {
    mockExecFileSync.mockImplementation((cmd, args) => {
      if (cmd === 'git' && Array.isArray(args) && args[0] === 'clone') {
        const cloneDir = String(args[args.length - 1]);
        const alphaDir = path.join(cloneDir, 'packages', 'alpha');
        fs.mkdirSync(alphaDir, { recursive: true });
        fs.writeFileSync(path.join(cloneDir, 'package.json'), JSON.stringify({
          name: 'opencli-plugins-__test-transactional__',
          private: true,
        }));
        fs.writeFileSync(path.join(cloneDir, 'opencli-plugin.json'), JSON.stringify({
          plugins: {
            alpha: { path: 'packages/alpha' },
          },
        }));
        fs.writeFileSync(path.join(alphaDir, 'hello.yaml'), 'site: test\nname: hello\n');
        return '';
      }
      if (cmd === 'npm' && Array.isArray(args) && args[0] === 'install') {
        throw new Error('boom');
      }
      if (cmd === 'git' && Array.isArray(args) && args[0] === 'rev-parse' && args[1] === 'HEAD') {
        return '1234567890abcdef1234567890abcdef12345678\n';
      }
      return '';
    });

    expect(() => installPlugin(monorepoSource)).toThrow(`npm install failed`);
    expect(fs.existsSync(monorepoRepoDir)).toBe(false);
    expect(fs.existsSync(monorepoLink)).toBe(false);
    expect(_readLockFile().alpha).toBeUndefined();
  });
});

describe('installPlugin with existing monorepo', () => {
  const repoName = '__test-existing-monorepo__';
  const repoDir = path.join(_getMonoreposDir(), repoName);
  const pluginName = 'beta';
  const pluginLink = path.join(PLUGINS_DIR, pluginName);

  beforeEach(() => {
    mockExecFileSync.mockClear();
    mockExecSync.mockClear();
  });

  afterEach(() => {
    try { fs.unlinkSync(pluginLink); } catch {}
    try { fs.rmSync(pluginLink, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(repoDir, { recursive: true, force: true }); } catch {}
    const lock = _readLockFile();
    delete lock[pluginName];
    _writeLockFile(lock);
    vi.clearAllMocks();
  });

  it('reinstalls root dependencies when adding a sub-plugin from an existing monorepo', () => {
    const subDir = path.join(repoDir, 'packages', pluginName);
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({
      name: repoName,
      private: true,
      workspaces: ['packages/*'],
    }));
    fs.writeFileSync(path.join(repoDir, 'opencli-plugin.json'), JSON.stringify({
      plugins: {
        [pluginName]: { path: `packages/${pluginName}` },
      },
    }));
    fs.writeFileSync(path.join(subDir, 'hello.yaml'), 'site: test\nname: hello\n');

    mockExecFileSync.mockImplementation((cmd, args) => {
      if (cmd === 'git' && Array.isArray(args) && args[0] === 'clone') {
        const cloneDir = String(args[4]);
        fs.mkdirSync(cloneDir, { recursive: true });
        fs.writeFileSync(path.join(cloneDir, 'opencli-plugin.json'), JSON.stringify({
          plugins: {
            [pluginName]: { path: `packages/${pluginName}` },
          },
        }));
        return '';
      }
      if (cmd === 'git' && Array.isArray(args) && args[0] === 'rev-parse' && args[1] === 'HEAD') {
        return '1234567890abcdef1234567890abcdef12345678\n';
      }
      return '';
    });

    installPlugin(`github:user/${repoName}/${pluginName}`);

    const npmCalls = mockExecFileSync.mock.calls.filter(
      ([cmd, args]) => cmd === 'npm' && Array.isArray(args) && args[0] === 'install',
    );
    expect(npmCalls.some(([, , opts]) => opts?.cwd === repoDir)).toBe(true);
    expect(fs.realpathSync(pluginLink)).toBe(subDir);
  });
});

describe('updatePlugin transactional staging', () => {
  const standaloneName = '__test-transactional-update__';
  const standaloneDir = path.join(PLUGINS_DIR, standaloneName);
  const monorepoName = '__test-transactional-mono-update__';
  const monorepoRepoDir = path.join(_getMonoreposDir(), monorepoName);
  const monorepoPluginName = 'alpha-update';
  const monorepoLink = path.join(PLUGINS_DIR, monorepoPluginName);

  beforeEach(() => {
    mockExecFileSync.mockClear();
    mockExecSync.mockClear();
  });

  afterEach(() => {
    try { fs.unlinkSync(monorepoLink); } catch {}
    try { fs.rmSync(monorepoLink, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(monorepoRepoDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(standaloneDir, { recursive: true, force: true }); } catch {}
    const lock = _readLockFile();
    delete lock[standaloneName];
    delete lock[monorepoPluginName];
    _writeLockFile(lock);
    vi.clearAllMocks();
  });

  it('keeps the existing standalone plugin when staged update preparation fails', () => {
    fs.mkdirSync(standaloneDir, { recursive: true });
    fs.writeFileSync(path.join(standaloneDir, 'old.yaml'), 'site: old\nname: old\n');

    const lock = _readLockFile();
    lock[standaloneName] = {
      source: 'https://github.com/user/opencli-plugin-__test-transactional-update__.git',
      commitHash: 'oldhasholdhasholdhasholdhasholdhasholdh',
      installedAt: '2025-01-01T00:00:00.000Z',
    };
    _writeLockFile(lock);

    mockExecFileSync.mockImplementation((cmd, args) => {
      if (cmd === 'git' && Array.isArray(args) && args[0] === 'clone') {
        const cloneDir = String(args[4]);
        fs.mkdirSync(cloneDir, { recursive: true });
        fs.writeFileSync(path.join(cloneDir, 'hello.yaml'), 'site: test\nname: hello\n');
        fs.writeFileSync(path.join(cloneDir, 'package.json'), JSON.stringify({ name: standaloneName }));
        return '';
      }
      if (cmd === 'npm' && Array.isArray(args) && args[0] === 'install') {
        throw new Error('boom');
      }
      if (cmd === 'git' && Array.isArray(args) && args[0] === 'rev-parse' && args[1] === 'HEAD') {
        return '1234567890abcdef1234567890abcdef12345678\n';
      }
      return '';
    });

    expect(() => updatePlugin(standaloneName)).toThrow('npm install failed');
    expect(fs.existsSync(standaloneDir)).toBe(true);
    expect(fs.readFileSync(path.join(standaloneDir, 'old.yaml'), 'utf-8')).toContain('site: old');
    expect(_readLockFile()[standaloneName]?.commitHash).toBe('oldhasholdhasholdhasholdhasholdhasholdh');
  });

  it('keeps the existing monorepo repo and link when staged update preparation fails', () => {
    const subDir = path.join(monorepoRepoDir, 'packages', monorepoPluginName);
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'old.yaml'), 'site: old\nname: old\n');
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    fs.symlinkSync(subDir, monorepoLink, 'dir');

    const lock = _readLockFile();
    lock[monorepoPluginName] = {
      source: 'https://github.com/user/opencli-plugins-__test-transactional-mono-update__.git',
      commitHash: 'oldmonooldmonooldmonooldmonooldmonoold',
      installedAt: '2025-01-01T00:00:00.000Z',
      monorepo: { name: monorepoName, subPath: `packages/${monorepoPluginName}` },
    };
    _writeLockFile(lock);

    mockExecFileSync.mockImplementation((cmd, args) => {
      if (cmd === 'git' && Array.isArray(args) && args[0] === 'clone') {
        const cloneDir = String(args[4]);
        const alphaDir = path.join(cloneDir, 'packages', monorepoPluginName);
        fs.mkdirSync(alphaDir, { recursive: true });
        fs.writeFileSync(path.join(cloneDir, 'package.json'), JSON.stringify({
          name: 'opencli-plugins-__test-transactional-mono-update__',
          private: true,
        }));
        fs.writeFileSync(path.join(cloneDir, 'opencli-plugin.json'), JSON.stringify({
          plugins: {
            [monorepoPluginName]: { path: `packages/${monorepoPluginName}` },
          },
        }));
        fs.writeFileSync(path.join(alphaDir, 'hello.yaml'), 'site: test\nname: hello\n');
        return '';
      }
      if (cmd === 'npm' && Array.isArray(args) && args[0] === 'install') {
        throw new Error('boom');
      }
      if (cmd === 'git' && Array.isArray(args) && args[0] === 'rev-parse' && args[1] === 'HEAD') {
        return '1234567890abcdef1234567890abcdef12345678\n';
      }
      return '';
    });

    expect(() => updatePlugin(monorepoPluginName)).toThrow('npm install failed');
    expect(fs.existsSync(monorepoRepoDir)).toBe(true);
    expect(fs.existsSync(monorepoLink)).toBe(true);
    expect(fs.readFileSync(path.join(subDir, 'old.yaml'), 'utf-8')).toContain('site: old');
    expect(_readLockFile()[monorepoPluginName]?.commitHash).toBe('oldmonooldmonooldmonooldmonooldmonoold');
  });

  it('relinks monorepo plugins when the updated manifest moves their subPath', () => {
    const oldSubDir = path.join(monorepoRepoDir, 'packages', 'old-alpha');
    fs.mkdirSync(oldSubDir, { recursive: true });
    fs.writeFileSync(path.join(oldSubDir, 'old.yaml'), 'site: old\nname: old\n');
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    fs.symlinkSync(oldSubDir, monorepoLink, 'dir');

    const lock = _readLockFile();
    lock[monorepoPluginName] = {
      source: 'https://github.com/user/opencli-plugins-__test-transactional-mono-update__.git',
      commitHash: 'oldmonooldmonooldmonooldmonooldmonoold',
      installedAt: '2025-01-01T00:00:00.000Z',
      monorepo: { name: monorepoName, subPath: 'packages/old-alpha' },
    };
    _writeLockFile(lock);

    mockExecFileSync.mockImplementation((cmd, args) => {
      if (cmd === 'git' && Array.isArray(args) && args[0] === 'clone') {
        const cloneDir = String(args[4]);
        const movedDir = path.join(cloneDir, 'packages', 'moved-alpha');
        fs.mkdirSync(movedDir, { recursive: true });
        fs.writeFileSync(path.join(cloneDir, 'opencli-plugin.json'), JSON.stringify({
          plugins: {
            [monorepoPluginName]: { path: 'packages/moved-alpha' },
          },
        }));
        fs.writeFileSync(path.join(movedDir, 'hello.yaml'), 'site: test\nname: hello\n');
        return '';
      }
      if (cmd === 'git' && Array.isArray(args) && args[0] === 'rev-parse' && args[1] === 'HEAD') {
        return '1234567890abcdef1234567890abcdef12345678\n';
      }
      return '';
    });

    updatePlugin(monorepoPluginName);

    const expectedTarget = path.join(monorepoRepoDir, 'packages', 'moved-alpha');
    expect(fs.realpathSync(monorepoLink)).toBe(expectedTarget);
    expect(_readLockFile()[monorepoPluginName]?.monorepo?.subPath).toBe('packages/moved-alpha');
  });

  it('rolls back the monorepo repo swap when relinking fails', () => {
    const oldSubDir = path.join(monorepoRepoDir, 'packages', 'old-alpha');
    fs.mkdirSync(oldSubDir, { recursive: true });
    fs.writeFileSync(path.join(oldSubDir, 'old.yaml'), 'site: old\nname: old\n');
    fs.mkdirSync(monorepoLink, { recursive: true });
    fs.writeFileSync(path.join(monorepoLink, 'blocker.txt'), 'not a symlink');

    const lock = _readLockFile();
    lock[monorepoPluginName] = {
      source: 'https://github.com/user/opencli-plugins-__test-transactional-mono-update__.git',
      commitHash: 'oldmonooldmonooldmonooldmonooldmonoold',
      installedAt: '2025-01-01T00:00:00.000Z',
      monorepo: { name: monorepoName, subPath: 'packages/old-alpha' },
    };
    _writeLockFile(lock);

    mockExecFileSync.mockImplementation((cmd, args) => {
      if (cmd === 'git' && Array.isArray(args) && args[0] === 'clone') {
        const cloneDir = String(args[4]);
        const movedDir = path.join(cloneDir, 'packages', 'moved-alpha');
        fs.mkdirSync(movedDir, { recursive: true });
        fs.writeFileSync(path.join(cloneDir, 'opencli-plugin.json'), JSON.stringify({
          plugins: {
            [monorepoPluginName]: { path: 'packages/moved-alpha' },
          },
        }));
        fs.writeFileSync(path.join(movedDir, 'hello.yaml'), 'site: test\nname: hello\n');
        return '';
      }
      if (cmd === 'git' && Array.isArray(args) && args[0] === 'rev-parse' && args[1] === 'HEAD') {
        return '1234567890abcdef1234567890abcdef12345678\n';
      }
      return '';
    });

    expect(() => updatePlugin(monorepoPluginName)).toThrow('to be a symlink');
    expect(fs.existsSync(path.join(monorepoRepoDir, 'packages', 'old-alpha', 'old.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(monorepoRepoDir, 'packages', 'moved-alpha'))).toBe(false);
    expect(fs.readFileSync(path.join(monorepoLink, 'blocker.txt'), 'utf-8')).toBe('not a symlink');
    expect(_readLockFile()[monorepoPluginName]?.monorepo?.subPath).toBe('packages/old-alpha');
  });
});
