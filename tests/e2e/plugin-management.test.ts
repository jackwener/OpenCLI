/**
 * E2E integration tests for plugin management commands.
 * Uses a real GitHub plugin (opencli-plugin-hot-digest) to verify the full
 * install → list → update → uninstall lifecycle in an isolated HOME.
 */

import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { runCli, parseJsonOutput } from './helpers.js';

const TEST_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-plugin-e2e-'));
const OPENCLI_HOME = path.join(TEST_HOME, '.opencli');
const PLUGINS_DIR = path.join(OPENCLI_HOME, 'plugins');
const PLUGIN_SOURCE = 'github:ByteYue/opencli-plugin-hot-digest';
const PLUGIN_NAME = 'hot-digest';
const PLUGIN_DIR = path.join(PLUGINS_DIR, PLUGIN_NAME);
const LOCK_FILE = path.join(OPENCLI_HOME, 'plugins.lock.json');

function runPluginCli(
  args: string[],
  opts: { timeout?: number; env?: Record<string, string> } = {},
) {
  return runCli(args, {
    ...opts,
    env: {
      HOME: TEST_HOME,
      USERPROFILE: TEST_HOME,
      ...opts.env,
    },
  });
}

describe('plugin management E2E', () => {
  afterAll(() => {
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
  });

  // ── plugin list (empty) ──
  it('plugin list shows "No plugins installed" when none exist', async () => {
    const { stdout, code } = await runPluginCli(['plugin', 'list']);
    expect(code).toBe(0);
    expect(stdout).toContain('No plugins installed');
  });

  // ── plugin install ──
  it('plugin install clones and sets up a real plugin', async () => {
    const { stdout, code } = await runPluginCli(['plugin', 'install', PLUGIN_SOURCE], {
      timeout: 60_000,
    });
    expect(code).toBe(0);
    expect(stdout).toContain('installed successfully');
    expect(stdout).toContain(PLUGIN_NAME);

    // Verify the plugin directory was created
    expect(fs.existsSync(PLUGIN_DIR)).toBe(true);

    // Verify lock file was updated
    const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
    expect(lock[PLUGIN_NAME]).toBeDefined();
    expect(lock[PLUGIN_NAME].commitHash).toBeTruthy();
    expect(lock[PLUGIN_NAME].source).toMatchObject({
      kind: 'git',
    });
    expect(lock[PLUGIN_NAME].source.url).toContain('opencli-plugin-hot-digest');
    expect(lock[PLUGIN_NAME].installedAt).toBeTruthy();
  }, 60_000);

  // ── plugin list (after install) ──
  it('plugin list shows the installed plugin', async () => {
    const { stdout, code } = await runPluginCli(['plugin', 'list']);
    expect(code).toBe(0);
    expect(stdout).toContain(PLUGIN_NAME);
  });

  it('plugin list -f json returns structured data', async () => {
    const { stdout, code } = await runPluginCli(['plugin', 'list', '-f', 'json']);
    expect(code).toBe(0);
    const data = parseJsonOutput(stdout);
    expect(Array.isArray(data)).toBe(true);

    const plugin = data.find((p: any) => p.name === PLUGIN_NAME);
    expect(plugin).toBeDefined();
    expect(plugin.name).toBe(PLUGIN_NAME);
    expect(Array.isArray(plugin.commands)).toBe(true);
    expect(plugin.commands.length).toBeGreaterThan(0);
  });

  // ── plugin update ──
  it('plugin update succeeds on an installed plugin', async () => {
    const { stdout, code } = await runPluginCli(['plugin', 'update', PLUGIN_NAME], {
      timeout: 30_000,
    });
    expect(code).toBe(0);
    expect(stdout).toContain('updated successfully');

    // Verify lock file has updatedAt
    const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
    expect(lock[PLUGIN_NAME].updatedAt).toBeTruthy();
  }, 30_000);

  // ── plugin uninstall ──
  it('plugin uninstall removes the plugin', async () => {
    const { stdout, code } = await runPluginCli(['plugin', 'uninstall', PLUGIN_NAME]);
    expect(code).toBe(0);
    expect(stdout).toContain('uninstalled');

    // Verify directory was removed
    expect(fs.existsSync(PLUGIN_DIR)).toBe(false);

    // Verify lock entry was removed
    const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
    expect(lock[PLUGIN_NAME]).toBeUndefined();
  });

  // ── error paths ──
  it('plugin install rejects invalid source', async () => {
    const { stderr, code } = await runPluginCli(['plugin', 'install', 'invalid-source-format']);
    expect(code).toBe(1);
    expect(stderr).toContain('Invalid plugin source');
  });

  it('plugin uninstall rejects non-existent plugin', async () => {
    const { stderr, code } = await runPluginCli(['plugin', 'uninstall', '__nonexistent_plugin_xyz__']);
    expect(code).toBe(1);
    expect(stderr).toContain('not installed');
  });

  it('plugin update rejects non-existent plugin', async () => {
    const { stderr, code } = await runPluginCli(['plugin', 'update', '__nonexistent_plugin_xyz__']);
    expect(code).toBe(1);
  });

  it('plugin update without name or --all shows error', async () => {
    const { stderr, code } = await runPluginCli(['plugin', 'update']);
    expect(code).toBe(1);
    expect(stderr).toContain('specify a plugin name');
  });
});
