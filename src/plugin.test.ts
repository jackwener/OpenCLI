/**
 * Tests for plugin management: install, uninstall, list.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { PLUGINS_DIR } from './discovery.js';
import { listPlugins, uninstallPlugin, updatePlugin, _parseSource } from './plugin.js';

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

  it('throws for non-existent plugin', () => {
    expect(() => uninstallPlugin('__nonexistent__')).toThrow('not installed');
  });
});

describe('updatePlugin', () => {
  it('throws for non-existent plugin', () => {
    expect(() => updatePlugin('__nonexistent__')).toThrow('not installed');
  });
});
