/**
 * E2E tests for management/built-in commands.
 * These commands require no external network access (except verify --smoke).
 */

import { describe, it, expect } from 'vitest';
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

  it('github alias forwards to gh', async () => {
    const { stdout, code } = await runCli(['github', '--help']);
    expect(code).toBe(0);
    expect(stdout).toContain('Work seamlessly with GitHub from the command line.');
    expect(stdout).toContain('gh <command> <subcommand> [flags]');
  });

  // ── unknown command ──
  it('unknown command shows error', async () => {
    const { stderr, code } = await runCli(['nonexistent-command-xyz']);
    expect(code).toBe(1);
  });
});
