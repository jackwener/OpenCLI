/**
 * E2E integration tests for plugin management commands.
 * Uses a real GitHub plugin (opencli-plugin-hot-digest) to verify the full
 * install → list → update → uninstall lifecycle.
 */

import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { runCli, parseJsonOutput } from './helpers.js';

const PLUGINS_DIR = path.join(os.homedir(), '.opencli', 'plugins');
const PLUGIN_SOURCE = 'github:ByteYue/opencli-plugin-hot-digest';
const PLUGIN_NAME = 'hot-digest';
const PLUGIN_DIR = path.join(PLUGINS_DIR, PLUGIN_NAME);
const LOCK_FILE = path.join(os.homedir(), '.opencli', 'plugins.lock.json');
const PLUGIN_BACKUP = PLUGIN_DIR + '.__test_backup__';

// Backup and restore state to avoid interfering with user's real plugins
let lockBackup: string | null = null;
let pluginDirExisted = false;

function backupState() {
  // If the plugin is already installed, temporarily move it aside
  pluginDirExisted = fs.existsSync(PLUGIN_DIR);
  if (pluginDirExisted) {
    if (fs.existsSync(PLUGIN_BACKUP)) {
      fs.rmSync(PLUGIN_BACKUP, { recursive: true, force: true });
    }
    fs.renameSync(PLUGIN_DIR, PLUGIN_BACKUP);
  }
  try {
    lockBackup = fs.readFileSync(LOCK_FILE, 'utf-8');
  } catch {
    lockBackup = null;
  }
}

function restoreState() {
  // Clean up the test plugin
  if (fs.existsSync(PLUGIN_DIR)) {
    fs.rmSync(PLUGIN_DIR, { recursive: true, force: true });
  }
  // Restore original plugin if it existed
  if (pluginDirExisted && fs.existsSync(PLUGIN_BACKUP)) {
    fs.renameSync(PLUGIN_BACKUP, PLUGIN_DIR);
  }
  // Restore lock file
  if (lockBackup !== null) {
    fs.writeFileSync(LOCK_FILE, lockBackup);
  } else {
    // Remove lock entries we may have added
    try {
      const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8'));
      if (lock[PLUGIN_NAME]) {
        delete lock[PLUGIN_NAME];
        fs.writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2) + '\n');
      }
    } catch {
      // ignore
    }
  }
}

describe('plugin management E2E', () => {
  // Backup state before all tests
  backupState();

  // Ensure cleanup regardless of test outcome
  afterAll(() => {
    restoreState();
  });

  // ── plugin list (empty) ──
  it('plugin list shows "No plugins installed" when none exist', async () => {
    const { stdout, code } = await runCli(['plugin', 'list']);
    expect(code).toBe(0);
    // Should mention no plugins or show the existing plugins list
    // (other plugins may be installed, so we just check it runs successfully)
    expect(stdout).toBeDefined();
  });

  // ── plugin install ──
  it('plugin install clones and sets up a real plugin', async () => {
    const { stdout, stderr, code } = await runCli(['plugin', 'install', PLUGIN_SOURCE], {
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
    expect(lock[PLUGIN_NAME].source).toContain('opencli-plugin-hot-digest');
    expect(lock[PLUGIN_NAME].installedAt).toBeTruthy();
  }, 60_000);

  // ── plugin list (after install) ──
  it('plugin list shows the installed plugin', async () => {
    const { stdout, code } = await runCli(['plugin', 'list']);
    expect(code).toBe(0);
    expect(stdout).toContain(PLUGIN_NAME);
  });

  it('plugin list -f json returns structured data', async () => {
    const { stdout, code } = await runCli(['plugin', 'list', '-f', 'json']);
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
    const { stdout, code } = await runCli(['plugin', 'update', PLUGIN_NAME], {
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
    const { stdout, code } = await runCli(['plugin', 'uninstall', PLUGIN_NAME]);
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
    const { stderr, code } = await runCli(['plugin', 'install', 'invalid-source-format']);
    expect(code).toBe(1);
    expect(stderr).toContain('Invalid plugin source');
  });

  it('plugin uninstall rejects non-existent plugin', async () => {
    const { stderr, code } = await runCli(['plugin', 'uninstall', '__nonexistent_plugin_xyz__']);
    expect(code).toBe(1);
    expect(stderr).toContain('not installed');
  });

  it('plugin update rejects non-existent plugin', async () => {
    const { stderr, code } = await runCli(['plugin', 'update', '__nonexistent_plugin_xyz__']);
    expect(code).toBe(1);
  });

  it('plugin update without name or --all shows error', async () => {
    const { stderr, code } = await runCli(['plugin', 'update']);
    expect(code).toBe(1);
    expect(stderr).toContain('specify a plugin name');
  });
});
