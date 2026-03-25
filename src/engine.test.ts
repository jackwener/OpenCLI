import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { discoverClis, discoverPlugins, PLUGINS_DIR, toImportHref } from './discovery.js';
import { executeCommand } from './execution.js';
import { getRegistry, cli, Strategy } from './registry.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('discoverClis', () => {
  it('encodes local paths as valid file import URLs', () => {
    expect(toImportHref('/tmp/opencli path/hello.ts')).toBe('file:///tmp/opencli%20path/hello.ts');
    expect(toImportHref('/tmp/opencli#hash/hello.ts')).toBe('file:///tmp/opencli%23hash/hello.ts');
  });

  it('handles non-existent directories gracefully', async () => {
    // Should not throw for missing directories
    await expect(discoverClis('/tmp/nonexistent-opencli-test-dir')).resolves.not.toThrow();
  });

  it('imports only CLI command modules during filesystem discovery', async () => {
    const tempRoot = await fs.promises.mkdtemp(path.join('/tmp', 'opencli-discovery-'));
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
import { cli, Strategy } from '${path.join(process.cwd(), 'src', 'registry.ts')}';
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
});
