import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { discoverClis, discoverPlugins, ensureUserCliCompatShims, ensureUserAdapters, PLUGINS_DIR } from './discovery.js';
import { executeCommand } from './execution.js';
import { getRegistry, cli, Strategy } from './registry.js';
import { clearAllHooks, onAfterExecute } from './hooks.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

async function captureStderr<T>(fn: () => Promise<T>): Promise<{ result: T; writes: string[] }> {
  const writes: string[] = [];
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  });
  try {
    return { result: await fn(), writes };
  } finally {
    stderr.mockRestore();
  }
}

describe('discoverClis', () => {
  it('handles non-existent directories gracefully', async () => {
    // Should not throw for missing directories
    await expect(discoverClis(path.join(os.tmpdir(), 'nonexistent-opencli-test-dir'))).resolves.not.toThrow();
  });

  it('imports only CLI command modules during filesystem discovery', async () => {
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-discovery-'));
    const siteDir = path.join(tempRoot, 'temp-site');
    const helperPath = path.join(siteDir, 'helper.js');
    const commandPath = path.join(siteDir, 'hello.js');

    try {
      await fs.promises.mkdir(siteDir, { recursive: true });
      await fs.promises.writeFile(helperPath, `
globalThis.__opencli_helper_loaded__ = true;
export const helper = true;
`);
      await fs.promises.writeFile(commandPath, `
import { cli, Strategy } from '${pathToFileURL(path.join(process.cwd(), 'src', 'registry.ts')).href}';
cli({
  site: 'temp-site',
  name: 'hello', access: 'read',
  description: 'hello command',
  strategy: Strategy.PUBLIC,
  browser: false,
  func: async () => [{ ok: true }],
});
`);

      delete (globalThis as { __opencli_helper_loaded__?: unknown }).__opencli_helper_loaded__;
      await discoverClis(tempRoot);

      expect((globalThis as { __opencli_helper_loaded__?: unknown }).__opencli_helper_loaded__).toBeUndefined();
      expect(getRegistry().get('temp-site/hello')).toBeDefined();
    } finally {
      delete (globalThis as { __opencli_helper_loaded__?: unknown }).__opencli_helper_loaded__;
      await fs.promises.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('warns once per site directory that holds skipped yaml adapters', async () => {
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-yaml-skip-'));
    const siteDir = path.join(tempRoot, 'yaml-site');

    try {
      await fs.promises.mkdir(siteDir, { recursive: true });
      await fs.promises.writeFile(path.join(siteDir, 'one.yaml'), 'name: one\ndescription: one command\nbrowser: false\n');
      await fs.promises.writeFile(path.join(siteDir, 'two.yml'), 'name: two\ndescription: two command\nbrowser: false\n');

      const { writes } = await captureStderr(() => discoverClis(tempRoot));

      const warnings = writes.filter((line) => line.includes('YAML adapter'));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('Ignoring 2 YAML adapters');
      expect(warnings[0]).toContain('site yaml-site');
      expect(warnings[0]).toContain('one.yaml, two.yml');
      expect(warnings[0]).toContain('cli() API');
    } finally {
      await fs.promises.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('stays silent for a yaml adapter that already has a .js replacement beside it', async () => {
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-yaml-migrated-'));
    const siteDir = path.join(tempRoot, 'migrated-site');

    try {
      await fs.promises.mkdir(siteDir, { recursive: true });
      await fs.promises.writeFile(path.join(siteDir, 'done.yaml'), 'name: done\ndescription: migrated command\nbrowser: false\n');
      await fs.promises.writeFile(path.join(siteDir, 'done.js'), `
import { cli, Strategy } from '${pathToFileURL(path.join(process.cwd(), 'src', 'registry.ts')).href}';
cli({
  site: 'migrated-site',
  name: 'done', access: 'read',
  description: 'migrated command',
  strategy: Strategy.PUBLIC,
  browser: false,
  func: async () => [{ ok: true }],
});
`);
      await fs.promises.writeFile(path.join(siteDir, 'pending.yml'), 'name: pending\ndescription: pending command\nbrowser: false\n');

      const { writes } = await captureStderr(() => discoverClis(tempRoot));

      const warnings = writes.filter((line) => line.includes('YAML adapter'));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('Ignoring 1 YAML adapter ');
      expect(warnings[0]).toContain('pending.yml');
      expect(warnings[0]).not.toContain('done.yaml');
    } finally {
      await fs.promises.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('warns when the same-basename js replacement is not a CLI module', async () => {
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-yaml-bad-js-'));
    const siteDir = path.join(tempRoot, 'bad-replacement-site');

    try {
      await fs.promises.mkdir(siteDir, { recursive: true });
      await fs.promises.writeFile(path.join(siteDir, 'ghost.yaml'), 'name: ghost\ndescription: ghost command\nbrowser: false\n');
      await fs.promises.writeFile(path.join(siteDir, 'ghost.js'), 'export const helper = true;\n');

      const { writes } = await captureStderr(() => discoverClis(tempRoot));

      const warnings = writes.filter((line) => line.includes('YAML adapter'));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('ghost.yaml');
    } finally {
      await fs.promises.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('warns when the same-basename js replacement is not loadable', async () => {
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-yaml-broken-js-'));
    const siteDir = path.join(tempRoot, 'broken-replacement-site');

    try {
      await fs.promises.mkdir(siteDir, { recursive: true });
      await fs.promises.writeFile(path.join(siteDir, 'broken.yaml'), 'name: broken\ndescription: broken command\nbrowser: false\n');
      await fs.promises.writeFile(path.join(siteDir, 'broken.js'), `
import { cli } from '${pathToFileURL(path.join(process.cwd(), 'src', 'registry.ts')).href}';
cli({
`);

      const { writes } = await captureStderr(() => discoverClis(tempRoot));

      const warnings = writes.filter((line) => line.includes('YAML adapter'));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('broken.yaml');
    } finally {
      await fs.promises.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('warns during valid-manifest fast path when yaml adapters are skipped', async () => {
    const tempBuildRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-yaml-manifest-'));
    const distDir = path.join(tempBuildRoot, 'dist');
    const siteDir = path.join(distDir, 'manifest-site');
    const manifestPath = path.join(tempBuildRoot, 'cli-manifest.json');

    try {
      await fs.promises.mkdir(siteDir, { recursive: true });
      await fs.promises.writeFile(manifestPath, '[]\n');
      await fs.promises.writeFile(path.join(siteDir, 'lost.yaml'), 'name: lost\ndescription: lost command\nbrowser: false\n');

      const { writes } = await captureStderr(() => discoverClis(distDir));

      const warnings = writes.filter((line) => line.includes('YAML adapter'));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('site manifest-site');
      expect(warnings[0]).toContain('lost.yaml');
    } finally {
      await fs.promises.rm(tempBuildRoot, { recursive: true, force: true });
    }
  });

  it('trusts a same-basename js replacement only when it is present in the valid manifest', async () => {
    const tempBuildRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-yaml-manifest-replacement-'));
    const distDir = path.join(tempBuildRoot, 'dist');
    const siteDir = path.join(distDir, 'manifest-replacement-site');
    const manifestPath = path.join(tempBuildRoot, 'cli-manifest.json');

    try {
      await fs.promises.mkdir(siteDir, { recursive: true });
      await fs.promises.writeFile(path.join(siteDir, 'done.yaml'), 'name: done\ndescription: done command\nbrowser: false\n');
      await fs.promises.writeFile(path.join(siteDir, 'done.js'), 'export const helper = true;\n');
      await fs.promises.writeFile(path.join(siteDir, 'ghost.yaml'), 'name: ghost\ndescription: ghost command\nbrowser: false\n');
      await fs.promises.writeFile(path.join(siteDir, 'ghost.js'), 'export const helper = true;\n');
      await fs.promises.writeFile(manifestPath, `${JSON.stringify([{
        site: 'manifest-replacement-site',
        name: 'done',
        access: 'read',
        browser: false,
        modulePath: 'manifest-replacement-site/done.js',
        sourceFile: 'manifest-replacement-site/done.js',
      }])}\n`);

      const { writes } = await captureStderr(() => discoverClis(distDir));

      const warnings = writes.filter((line) => line.includes('YAML adapter'));
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('ghost.yaml');
      expect(warnings[0]).not.toContain('done.yaml');
    } finally {
      await fs.promises.rm(tempBuildRoot, { recursive: true, force: true });
    }
  });

  it('does not repeat the same yaml warning across repeated discovery calls', async () => {
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-yaml-repeat-'));
    const siteDir = path.join(tempRoot, 'repeat-site');

    try {
      await fs.promises.mkdir(siteDir, { recursive: true });
      await fs.promises.writeFile(path.join(siteDir, 'once.yaml'), 'name: once\ndescription: once command\nbrowser: false\n');

      const { writes } = await captureStderr(async () => {
        await discoverClis(tempRoot);
        await discoverClis(tempRoot);
      });

      expect(writes.filter((line) => line.includes('YAML adapter'))).toHaveLength(1);
    } finally {
      await fs.promises.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('still warns for a newly added skipped yaml adapter after an earlier discovery call', async () => {
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-yaml-repeat-new-'));
    const siteDir = path.join(tempRoot, 'repeat-new-site');

    try {
      await fs.promises.mkdir(siteDir, { recursive: true });
      await fs.promises.writeFile(path.join(siteDir, 'first.yaml'), 'name: first\ndescription: first command\nbrowser: false\n');

      const first = await captureStderr(() => discoverClis(tempRoot));
      await fs.promises.writeFile(path.join(siteDir, 'second.yml'), 'name: second\ndescription: second command\nbrowser: false\n');
      const second = await captureStderr(() => discoverClis(tempRoot));

      expect(first.writes.filter((line) => line.includes('YAML adapter'))).toHaveLength(1);
      const secondWarnings = second.writes.filter((line) => line.includes('YAML adapter'));
      expect(secondWarnings).toHaveLength(1);
      expect(secondWarnings[0]).toContain('second.yml');
      expect(secondWarnings[0]).not.toContain('first.yaml');
    } finally {
      await fs.promises.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('stays silent for a site directory with no yaml adapters', async () => {
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-yaml-none-'));
    const siteDir = path.join(tempRoot, 'js-only-site');

    try {
      await fs.promises.mkdir(siteDir, { recursive: true });
      await fs.promises.writeFile(path.join(siteDir, 'notes.md'), '# notes\n');

      const { writes } = await captureStderr(() => discoverClis(tempRoot));

      expect(writes.filter((line) => line.includes('YAML adapter'))).toEqual([]);
    } finally {
      await fs.promises.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('falls back to filesystem discovery when the manifest is invalid', async () => {
    const tempBuildRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-manifest-fallback-'));
    const distDir = path.join(tempBuildRoot, 'dist');
    const siteDir = path.join(distDir, 'fallback-site');
    const commandPath = path.join(siteDir, 'hello.js');
    const manifestPath = path.join(tempBuildRoot, 'cli-manifest.json');

    try {
      await fs.promises.mkdir(siteDir, { recursive: true });
      await fs.promises.writeFile(manifestPath, '{ invalid json');
      await fs.promises.writeFile(commandPath, `
import { cli, Strategy } from '${pathToFileURL(path.join(process.cwd(), 'src', 'registry.ts')).href}';
cli({
  site: 'fallback-site',
  name: 'hello', access: 'read',
  description: 'hello command',
  strategy: Strategy.PUBLIC,
  browser: false,
  func: async () => [{ ok: true }],
});
`);

      await discoverClis(distDir);

      expect(getRegistry().get('fallback-site/hello')).toBeDefined();
    } finally {
      await fs.promises.rm(tempBuildRoot, { recursive: true, force: true });
    }
  });

  it('loads user CLI modules via package exports symlink', async () => {
    const tempOpencliRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-user-clis-'));
    const userClisDir = path.join(tempOpencliRoot, 'clis');
    const siteDir = path.join(userClisDir, 'legacy-site');
    const commandPath = path.join(siteDir, 'hello.js');

    try {
      await ensureUserCliCompatShims(tempOpencliRoot);
      await fs.promises.mkdir(siteDir, { recursive: true });
      await fs.promises.writeFile(commandPath, `
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { htmlToMarkdown } from '@jackwener/opencli/utils';

cli({
  site: 'legacy-site',
  name: 'hello', access: 'read',
  description: 'hello command',
  strategy: Strategy.PUBLIC,
  browser: false,
  func: async () => [{ ok: true, errorName: new CommandExecutionError('boom').name, markdown: htmlToMarkdown('<p>hello</p>') }],
});
`);

      await discoverClis(userClisDir);

      const cmd = getRegistry().get('legacy-site/hello');
      expect(cmd).toBeDefined();
      await expect(executeCommand(cmd!, {})).resolves.toEqual([{ ok: true, errorName: 'CommandExecutionError', markdown: 'hello' }]);
    } finally {
      await fs.promises.rm(tempOpencliRoot, { recursive: true, force: true });
    }
  });
});

describe('ensureUserAdapters', () => {
  it('creates user clis directory without triggering full copy', async () => {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-ensure-'));
    const clisDir = path.join(tempDir, 'clis');
    try {
      // Patch USER_CLIS_DIR is not easy, so we test the function behavior indirectly:
      // ensureUserAdapters should not throw and should be very fast (no fetch script)
      const start = Date.now();
      await ensureUserAdapters();
      const elapsed = Date.now() - start;
      // Should complete quickly (< 1s) since it only creates a directory
      expect(elapsed).toBeLessThan(1000);
    } finally {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
  });

  it('discoverClis handles empty user directory gracefully', async () => {
    const emptyDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-empty-'));
    try {
      // Should not throw for an empty directory (no adapters to discover)
      await expect(discoverClis(emptyDir)).resolves.not.toThrow();
    } finally {
      await fs.promises.rm(emptyDir, { recursive: true, force: true });
    }
  });
});

describe('discoverPlugins', () => {
  const testPluginDir = path.join(PLUGINS_DIR, '__test-plugin__');
  const yamlPath = path.join(testPluginDir, 'greeting.yaml');
  const symlinkTargetDir = path.join(os.tmpdir(), '__test-plugin-symlink-target__');
  const symlinkPluginDir = path.join(PLUGINS_DIR, '__test-plugin-symlink__');
  const brokenSymlinkDir = path.join(PLUGINS_DIR, '__test-plugin-broken__');
  const dirSymlinkType: fs.symlink.Type = process.platform === 'win32' ? 'junction' : 'dir';

  afterEach(async () => {
    try { await fs.promises.rm(testPluginDir, { recursive: true }); } catch {}
    try { await fs.promises.rm(symlinkPluginDir, { recursive: true, force: true }); } catch {}
    try { await fs.promises.rm(symlinkTargetDir, { recursive: true, force: true }); } catch {}
    try { await fs.promises.rm(brokenSymlinkDir, { recursive: true, force: true }); } catch {}
  });

  it('ignores YAML files in plugin directories (YAML format removed)', async () => {
    await fs.promises.mkdir(testPluginDir, { recursive: true });
    await fs.promises.writeFile(yamlPath, `
site: __test-plugin__
name: greeting
description: Test plugin greeting
strategy: public
browser: false
`);
    await fs.promises.writeFile(path.join(testPluginDir, 'config.yaml'), `
name: config
version: 1
`);
    await fs.promises.writeFile(path.join(testPluginDir, 'data.yml'), `
- just
- data
`);

    const { writes } = await captureStderr(() => discoverPlugins());

    const registry = getRegistry();
    const cmd = registry.get('__test-plugin__/greeting');
    expect(cmd).toBeUndefined();
    const warnings = writes.filter((line) => line.includes('YAML adapter') && line.includes('plugin __test-plugin__'));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('greeting.yaml');
    expect(warnings[0]).not.toContain('config.yaml');
    expect(warnings[0]).not.toContain('data.yml');
  });

  it('handles non-existent plugins directory gracefully', async () => {
    // discoverPlugins should not throw if ~/.opencli/plugins/ does not exist
    await expect(discoverPlugins()).resolves.not.toThrow();
  });

  it('ignores YAML files in symlinked plugin directories (YAML format removed)', async () => {
    await fs.promises.mkdir(PLUGINS_DIR, { recursive: true });
    await fs.promises.mkdir(symlinkTargetDir, { recursive: true });
    await fs.promises.writeFile(path.join(symlinkTargetDir, 'hello.yaml'), `
site: __test-plugin-symlink__
name: hello
description: Test plugin greeting via symlink
strategy: public
browser: false
`);
    await fs.promises.symlink(symlinkTargetDir, symlinkPluginDir, dirSymlinkType);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await discoverPlugins();
    } finally {
      stderr.mockRestore();
    }

    const cmd = getRegistry().get('__test-plugin-symlink__/hello');
    expect(cmd).toBeUndefined();
  });

  it('skips broken plugin symlinks without throwing', async () => {
    await fs.promises.mkdir(PLUGINS_DIR, { recursive: true });
    await fs.promises.symlink(path.join(os.tmpdir(), '__missing-plugin-target__'), brokenSymlinkDir, dirSymlinkType);

    await expect(discoverPlugins()).resolves.not.toThrow();
    expect(getRegistry().get('__test-plugin-broken__/hello')).toBeUndefined();
  });
});

describe('executeCommand', () => {
  beforeEach(() => {
    clearAllHooks();
    vi.unstubAllEnvs();
  });

  it('accepts kebab-case option names after Commander camelCases them', async () => {
    const cmd = cli({
      site: 'test-engine',
      name: 'kebab-arg-test', access: 'read',
      description: 'test command with kebab-case arg',
      browser: false,
      strategy: Strategy.PUBLIC,
      args: [
        { name: 'note-id', required: true, help: 'Note ID' },
      ],
      func: async (kwargs) => [{ noteId: kwargs['note-id'] }],
    });

    const result = await executeCommand(cmd, { 'note-id': 'abc123' });
    expect(result).toEqual([{ noteId: 'abc123' }]);
  });

  it('executes a command with func', async () => {
    const cmd = cli({
      site: 'test-engine',
      name: 'func-test', access: 'read',
      description: 'test command with func',
      browser: false,
      strategy: Strategy.PUBLIC,
      func: async (kwargs) => {
        return [{ title: kwargs.query ?? 'default' }];
      },
    });

    const result = await executeCommand(cmd, { query: 'hello' });
    expect(result).toEqual([{ title: 'hello' }]);
  });

  it('executes a command with pipeline', async () => {
    const cmd = cli({
      site: 'test-engine',
      name: 'pipe-test', access: 'read',
      description: 'test command with pipeline',
      browser: false,
      strategy: Strategy.PUBLIC,
      pipeline: [
        { evaluate: '() => [{ n: 1 }, { n: 2 }, { n: 3 }]' },
        { limit: '2' },
      ],
    });

    // Pipeline commands require page for evaluate step, so we'll test the error path
    await expect(executeCommand(cmd, {})).rejects.toThrow();
  });

  it('throws for command with no func or pipeline', async () => {
    const cmd = cli({
      site: 'test-engine',
      name: 'empty-test', access: 'read',
      description: 'empty command',
      browser: false,
    });

    await expect(executeCommand(cmd, {})).rejects.toThrow('has no func or pipeline');
  });

  it('passes debug flag to func', async () => {
    let receivedDebug = false;
    const cmd = cli({
      site: 'test-engine',
      name: 'debug-test', access: 'read',
      description: 'debug test',
      browser: false,
      func: async (_kwargs, debug) => {
        receivedDebug = debug ?? false;
        return [];
      },
    });

    await executeCommand(cmd, {}, true);
    expect(receivedDebug).toBe(true);
  });

  it('fires onAfterExecute even when command execution throws', async () => {
    const seen: Array<{ error?: unknown; finishedAt?: number }> = [];
    onAfterExecute((ctx) => {
      seen.push({ error: ctx.error, finishedAt: ctx.finishedAt });
    });

    const cmd = cli({
      site: 'test-engine',
      name: 'failing-test', access: 'read',
      description: 'failing command',
      browser: false,
      strategy: Strategy.PUBLIC,
      func: async () => {
        throw new Error('boom');
      },
    });

    await expect(executeCommand(cmd, {})).rejects.toThrow('boom');
    expect(seen).toHaveLength(1);
    expect(seen[0].error).toBeInstanceOf(Error);
    expect((seen[0].error as Error).message).toBe('boom');
    expect(typeof seen[0].finishedAt).toBe('number');
  });

  it('uses launcher for registered Electron apps (chatwise)', async () => {
    // Mock the launcher to return a fake endpoint (avoids real HTTP/process calls)
    const launcher = await import('./launcher.js');
    const spy = vi.spyOn(launcher, 'resolveElectronEndpoint')
      .mockResolvedValue('http://127.0.0.1:9228');

    const cmd = cli({
      site: 'chatwise',
      name: 'status', access: 'read',
      description: 'chatwise status',
      browser: true,
      strategy: Strategy.PUBLIC,
      func: async () => [{ ok: true }],
    });

    // CDPBridge.connect() will fail (no actual CDP server), but the launcher
    // should have been called with 'chatwise'.
    await expect(executeCommand(cmd, {})).rejects.toThrow();
    expect(spy).toHaveBeenCalledWith('chatwise');
    spy.mockRestore();
  });
});
