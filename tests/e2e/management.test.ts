/**
 * E2E tests for management/built-in commands.
 * These commands require no external network access (except verify --smoke).
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runCli, parseJsonOutput } from './helpers.js';

describe('management commands E2E', () => {

  // ── list ──
  it('list shows all registered commands', async () => {
    const { stdout, code } = await runCli(['list', '-f', 'json']);
    expect(code).toBe(0);
    const data = parseJsonOutput(stdout);
    expect(Array.isArray(data)).toBe(true);
    // Should have 50+ commands across 18 sites
    expect(data.length).toBeGreaterThan(50);
    // Each entry should have the standard fields
    expect(data[0]).toHaveProperty('command');
    expect(data[0]).toHaveProperty('site');
    expect(data[0]).toHaveProperty('name');
    expect(data[0]).toHaveProperty('strategy');
    expect(data[0]).toHaveProperty('browser');
  });

  it('list default table format renders sites', async () => {
    const { stdout, code } = await runCli(['list']);
    expect(code).toBe(0);
    // Should contain site names
    expect(stdout).toContain('hackernews');
    expect(stdout).toContain('bilibili');
    expect(stdout).toContain('twitter');
    expect(stdout).toContain('commands across');
  });

  it('list -f yaml produces valid yaml', async () => {
    const { stdout, code } = await runCli(['list', '-f', 'yaml']);
    expect(code).toBe(0);
    expect(stdout).toContain('command:');
    expect(stdout).toContain('site:');
  });

  it('list -f csv produces valid csv', async () => {
    const { stdout, code } = await runCli(['list', '-f', 'csv']);
    expect(code).toBe(0);
    const lines = stdout.trim().split('\n');
    expect(lines.length).toBeGreaterThan(50);
  });

  it('list -f md produces markdown table', async () => {
    const { stdout, code } = await runCli(['list', '-f', 'md']);
    expect(code).toBe(0);
    expect(stdout).toContain('|');
    expect(stdout).toContain('command');
  });

  // ── validate ──
  it('validate passes for all built-in adapters', async () => {
    const { stdout, code } = await runCli(['validate']);
    expect(code).toBe(0);
    expect(stdout).toContain('PASS');
    expect(stdout).not.toContain('❌');
  });

  it('validate works for specific site', async () => {
    const { stdout, code } = await runCli(['validate', 'hackernews']);
    expect(code).toBe(0);
    expect(stdout).toContain('PASS');
  });

  it('validate works for specific command', async () => {
    const { stdout, code } = await runCli(['validate', 'hackernews/top']);
    expect(code).toBe(0);
    expect(stdout).toContain('PASS');
  });

  // ── verify ──
  it('verify runs validation without smoke tests', async () => {
    const { stdout, code } = await runCli(['verify']);
    expect(code).toBe(0);
    expect(stdout).toContain('PASS');
  });

  // ── version ──
  it('--version shows version number', async () => {
    const { stdout, code } = await runCli(['--version']);
    expect(code).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  // ── help ──
  it('--help shows usage', async () => {
    const { stdout, code } = await runCli(['--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('opencli');
    expect(stdout).toContain('list');
    expect(stdout).toContain('validate');
  });

  // ── unknown command ──
  it('unknown command shows error', async () => {
    const { stderr, code } = await runCli(['nonexistent-command-xyz']);
    expect(code).toBe(2);
  });

  it('can disable and re-enable a site through adapter policy commands', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-policy-e2e-'));
    const policyPath = path.join(dir, 'policy.yaml');
    const env = { OPENCLI_POLICY_FILE: policyPath };

    try {
      const disabled = await runCli(['adapter', 'disable', 'hackernews'], { env });
      expect(disabled.code).toBe(0);

      const listAfterDisable = await runCli(['list', '-f', 'json'], { env });
      expect(listAfterDisable.code).toBe(0);
      const disabledCatalog = parseJsonOutput(listAfterDisable.stdout);
      expect(disabledCatalog.some((item: any) => item.site === 'hackernews')).toBe(false);

      const blocked = await runCli(['hackernews', 'top'], { env });
      expect(blocked.code).toBe(78);
      expect(blocked.stderr).toContain("adapter site 'hackernews' is disabled");

      const enabled = await runCli(['adapter', 'enable', 'hackernews'], { env });
      expect(enabled.code).toBe(0);

      const listAfterEnable = await runCli(['list', '-f', 'json'], { env });
      const enabledCatalog = parseJsonOutput(listAfterEnable.stdout);
      expect(enabledCatalog.some((item: any) => item.site === 'hackernews')).toBe(true);

      const disabledApp = await runCli(['adapter', 'disable', 'antigravity'], { env });
      expect(disabledApp.code).toBe(0);
      const blockedApp = await runCli(['antigravity', 'serve'], { env });
      expect(blockedApp.code).toBe(78);
      expect(blockedApp.stderr).toContain("adapter site 'antigravity' is disabled");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
