import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { discoverClis, discoverPlugins, PLUGINS_DIR } from './discovery.js';
import { executeCommand } from './execution.js';
import { getRegistry, cli, Strategy } from './registry.js';
import { clearAllHooks, onAfterExecute } from './hooks.js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

describe('discoverClis', () => {
  it('handles non-existent directories gracefully', async () => {
    // Should not throw for missing directories
    await expect(discoverClis(path.join(os.tmpdir(), 'nonexistent-opencli-test-dir'))).resolves.not.toThrow();
  });

  it('imports only CLI command modules during filesystem discovery', async () => {
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-discovery-'));
    const siteDir = path.join(tempRoot, 'temp-site');
    const helperPath = path.join(siteDir, 'helper.ts');
    const commandPath = path.join(siteDir, 'hello.ts');

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
  name: 'hello',
  description: 'hello command',
  strategy: Strategy.PUBLIC,
  browser: false,
  func: async () => [{ ok: true }],
});
`);

      delete (globalThis as any).__opencli_helper_loaded__;
      await discoverClis(tempRoot);

      expect((globalThis as any).__opencli_helper_loaded__).toBeUndefined();
      expect(getRegistry().get('temp-site/hello')).toBeDefined();
    } finally {
      delete (globalThis as any).__opencli_helper_loaded__;
      await fs.promises.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('falls back to filesystem discovery when the manifest is invalid', async () => {
    const tempBuildRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'opencli-manifest-fallback-'));
    const distDir = path.join(tempBuildRoot, 'dist');
    const siteDir = path.join(distDir, 'fallback-site');
    const commandPath = path.join(siteDir, 'hello.ts');
    const manifestPath = path.join(tempBuildRoot, 'cli-manifest.json');

    try {
      await fs.promises.mkdir(siteDir, { recursive: true });
      await fs.promises.writeFile(manifestPath, '{ invalid json');
      await fs.promises.writeFile(commandPath, `
import { cli, Strategy } from '${pathToFileURL(path.join(process.cwd(), 'src', 'registry.ts')).href}';
cli({
  site: 'fallback-site',
  name: 'hello',
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
});

describe('discoverPlugins', () => {
  const testPluginDir = path.join(PLUGINS_DIR, '__test-plugin__');
  const yamlPath = path.join(testPluginDir, 'greeting.yaml');

  afterEach(async () => {
    try { await fs.promises.rm(testPluginDir, { recursive: true }); } catch {}
  });

  it('discovers YAML plugins from ~/.opencli/plugins/', async () => {
    // Create a simple YAML adapter in the plugins directory
    await fs.promises.mkdir(testPluginDir, { recursive: true });
    await fs.promises.writeFile(yamlPath, `
site: __test-plugin__
name: greeting
description: Test plugin greeting
strategy: public
browser: false

pipeline:
  - evaluate: "() => [{ message: 'hello from plugin' }]"

columns: [message]
`);

    await discoverPlugins();

    const registry = getRegistry();
    const cmd = registry.get('__test-plugin__/greeting');
    expect(cmd).toBeDefined();
    expect(cmd!.site).toBe('__test-plugin__');
    expect(cmd!.name).toBe('greeting');
    expect(cmd!.description).toBe('Test plugin greeting');
  });

  it('handles non-existent plugins directory gracefully', async () => {
    // discoverPlugins should not throw if ~/.opencli/plugins/ does not exist
    await expect(discoverPlugins()).resolves.not.toThrow();
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
      name: 'kebab-arg-test',
      description: 'test command with kebab-case arg',
      browser: false,
      strategy: Strategy.PUBLIC,
      args: [
        { name: 'note-id', required: true, help: 'Note ID' },
      ],
      func: async (_page, kwargs) => [{ noteId: kwargs['note-id'] }],
    });

    const result = await executeCommand(cmd, { 'note-id': 'abc123' });
    expect(result).toEqual([{ noteId: 'abc123' }]);
  });

  it('executes a command with func', async () => {
    const cmd = cli({
      site: 'test-engine',
      name: 'func-test',
      description: 'test command with func',
      browser: false,
      strategy: Strategy.PUBLIC,
      func: async (_page, kwargs) => {
        return [{ title: kwargs.query ?? 'default' }];
      },
    });

    const result = await executeCommand(cmd, { query: 'hello' });
    expect(result).toEqual([{ title: 'hello' }]);
  });

  it('executes a command with pipeline', async () => {
    const cmd = cli({
      site: 'test-engine',
      name: 'pipe-test',
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
      name: 'empty-test',
      description: 'empty command',
      browser: false,
    });

    await expect(executeCommand(cmd, {})).rejects.toThrow('has no func or pipeline');
  });

  it('passes debug flag to func', async () => {
    let receivedDebug = false;
    const cmd = cli({
      site: 'test-engine',
      name: 'debug-test',
      description: 'debug test',
      browser: false,
      func: async (_page, _kwargs, debug) => {
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
      name: 'failing-test',
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

  it('fails fast for chatwise commands when OPENCLI_CDP_ENDPOINT is missing', async () => {
    const cmd = cli({
      site: 'chatwise',
      name: 'status',
      description: 'chatwise status',
      browser: true,
      strategy: Strategy.PUBLIC,
      requiredEnv: [
        {
          name: 'OPENCLI_CDP_ENDPOINT',
          help: 'Set OPENCLI_CDP_ENDPOINT before running chatwise commands.',
        },
      ],
      func: async () => [{ ok: true }],
    });

    await expect(executeCommand(cmd, {})).rejects.toThrow('requires environment variable OPENCLI_CDP_ENDPOINT');
  });
});
