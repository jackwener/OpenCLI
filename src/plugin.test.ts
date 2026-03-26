/**
 * Tests for plugin management: install, uninstall, list, and lock file support.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PLUGINS_DIR } from './discovery.js';
import type { LockEntry } from './plugin.js';
import * as pluginModule from './plugin.js';

const {
  LOCK_FILE,
  _getCommitHash,
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
} = pluginModule;

describe('parseSource', () => {
  it('parses github:user/repo format', () => {
    const result = _parseSource('github:ByteYue/opencli-plugin-github-trending');
    expect(result).toEqual({
      cloneUrl: 'https://github.com/ByteYue/opencli-plugin-github-trending.git',
      name: 'github-trending',
    });
  });

  it('parses https URL format', () => {
    const result = _parseSource('https://github.com/ByteYue/opencli-plugin-hot-digest');
    expect(result).toEqual({
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
  const backupPath = `${LOCK_FILE}.test-backup`;
  let hadOriginal = false;

  beforeEach(() => {
    hadOriginal = fs.existsSync(LOCK_FILE);
    if (hadOriginal) {
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.copyFileSync(LOCK_FILE, backupPath);
    }
  });

  afterEach(() => {
    if (hadOriginal) {
      fs.copyFileSync(backupPath, LOCK_FILE);
      fs.unlinkSync(backupPath);
      return;
    }
    try { fs.unlinkSync(LOCK_FILE); } catch {}
  });

  it('reads empty lock when file does not exist', () => {
    try { fs.unlinkSync(LOCK_FILE); } catch {}
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
    fs.mkdirSync(path.dirname(LOCK_FILE), { recursive: true });
    fs.writeFileSync(LOCK_FILE, 'not valid json');
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
    // On Windows the resolved path ends with 'esbuild.cmd', on Unix 'esbuild'
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
    // listPlugins should handle missing dir gracefully
    const plugins = listPlugins();
    expect(Array.isArray(plugins)).toBe(true);
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
});

vi.mock('node:child_process', () => {
  return {
    execFileSync: vi.fn((_cmd, args, opts) => {
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
    execSync: vi.fn(() => ''),
  };
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
  });

  afterEach(() => {
    try { fs.rmSync(testDirA, { recursive: true }); } catch {}
    try { fs.rmSync(testDirB, { recursive: true }); } catch {}
    try { fs.rmSync(testDirC, { recursive: true }); } catch {}
    vi.clearAllMocks();
  });

  it('collects successes and failures without throwing', () => {
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
    // We need to use the real PLUGINS_DIR for uninstallPlugin() to work
    pluginDir = path.join(PLUGINS_DIR, '__test-mono-sub__');
    monoDir = path.join(_getMonoreposDir(), '__test-mono__');

    // Set up monorepo structure
    const subDir = path.join(monoDir, 'packages', 'sub');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, 'cmd.yaml'), 'site: test');

    // Create symlink in plugins dir
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    fs.symlinkSync(subDir, pluginDir, 'dir');

    // Set up lock file with monorepo entry
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
    // Clean up lock entry
    const lock = _readLockFile();
    delete lock['__test-mono-sub__'];
    _writeLockFile(lock);
  });

  it('removes symlink but keeps monorepo if other sub-plugins reference it', () => {
    // Add another sub-plugin referencing the same monorepo
    const lock = _readLockFile();
    lock['__test-mono-other__'] = {
      source: 'https://github.com/user/test.git',
      commitHash: 'abc123',
      installedAt: '2025-01-01T00:00:00.000Z',
      monorepo: { name: '__test-mono__', subPath: 'packages/other' },
    };
    _writeLockFile(lock);

    uninstallPlugin('__test-mono-sub__');

    // Symlink removed
    expect(fs.existsSync(pluginDir)).toBe(false);
    // Monorepo dir still exists (other sub-plugin references it)
    expect(fs.existsSync(monoDir)).toBe(true);
    // Lock entry removed
    expect(_readLockFile()['__test-mono-sub__']).toBeUndefined();
    // Other lock entry still present
    expect(_readLockFile()['__test-mono-other__']).toBeDefined();

    // Clean up the other entry
    const finalLock = _readLockFile();
    delete finalLock['__test-mono-other__'];
    _writeLockFile(finalLock);
  });

  it('removes symlink AND monorepo dir when last sub-plugin is uninstalled', () => {
    uninstallPlugin('__test-mono-sub__');

    // Symlink removed
    expect(fs.existsSync(pluginDir)).toBe(false);
    // Monorepo dir also removed (no more references)
    expect(fs.existsSync(monoDir)).toBe(false);
    // Lock entry removed
    expect(_readLockFile()['__test-mono-sub__']).toBeUndefined();
  });
});

describe('listPlugins with monorepo metadata', () => {
  const testSymlinkTarget = path.join(os.tmpdir(), 'opencli-list-mono-target');
  const testLink = path.join(PLUGINS_DIR, '__test-mono-list__');

  beforeEach(() => {
    // Create a target dir with a command file
    fs.mkdirSync(testSymlinkTarget, { recursive: true });
    fs.writeFileSync(path.join(testSymlinkTarget, 'hello.yaml'), 'site: test\nname: hello\n');

    // Create symlink
    fs.mkdirSync(PLUGINS_DIR, { recursive: true });
    try { fs.unlinkSync(testLink); } catch {}
    fs.symlinkSync(testSymlinkTarget, testLink, 'dir');

    // Set up lock file with monorepo entry
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
