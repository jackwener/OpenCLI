/**
 * E2E tests for management/built-in commands.
 * These commands require no external network access (except verify --smoke).
 */

import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { runCli, parseJsonOutput } from './helpers.js';

describe('management commands E2E', () => {

  it.each([['list'], ['auth', 'status', '--site', 'ctrip'], ['yollomi', 'models']])(
    '%s rejects an unknown format with a usage error', async (...args) => {
      const result = await runCli([...args, '-f', 'bogus']);
      expect(result.code).toBe(2);
      expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { exitCode: 2 } });
    },
  );

  it('returns an early configuration failure as one JSON envelope', async () => {
    const result = await runCli(['list'], { env: { OPENCLI_DAEMON_PORT: '9999' } });
    expect(result.code).not.toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, error: { code: 'CONFIG', exitCode: result.code } });
  });

  // ── list ──
  it('searches and paginates capabilities', async () => {
    const first = await runCli(['list', '--limit', '2']);
    expect(first.code).toBe(0);
    const data = parseJsonOutput(first.stdout);
    expect(data.commands).toHaveLength(2);
    expect(data.nextOffset).toBe(2);
    expect(data.total).toBeGreaterThan(50);
    const second = parseJsonOutput((await runCli(['list', '--offset', '2', '--limit', '2'])).stdout);
    expect(second.commands[0].command).not.toBe(data.commands[0].command);
    const site = parseJsonOutput((await runCli(['list', 'top', '--site', 'hackernews'])).stdout);
    expect(site.commands.some((row: any) => row.command === 'hackernews top')).toBe(true);
  });
  it.each(['yaml', 'csv', 'md', 'table'])('exports a compact list as %s', async format => {
    const result = await runCli(['list', '--site', 'hackernews', '-f', format]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('hackernews');
  });
  it.each([[], ['hackernews'], ['hackernews/top']])('checks adapter definitions %s', async (...target) => {
    const result = await runCli(['adapter', 'check', ...target]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, data: { ok: true } });
  });
  it('rejects removed workflow commands with one error envelope', async () => {
    const result = await runCli(['validate']);
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout).ok).toBe(false);
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
    expect(stdout).toContain('adapter');
  });

  // ── unknown command ──
  it('unknown command shows error', async () => {
    const { stderr, code } = await runCli(['nonexistent-command-xyz']);
    expect(code).toBe(2);
  });
});

// Run removal checks against a legacy config in an isolated home directory.
describe('removed integrations E2E', () => {
  const removedSites = [
    'cursor', 'codex', 'chatwise', 'discord-app', 'doubao-app',
    'antigravity', 'chatgpt-app', 'qoder', 'trae-solo', 'trae-cn',
  ];
  let home: string;
  let env: Record<string, string>;

  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'opencli-removed-integrations-'));
    env = { HOME: home, USERPROFILE: home, CI: '1' };
    mkdirSync(join(home, '.opencli'), { recursive: true });
    writeFileSync(join(home, '.opencli', 'external-clis.yaml'), '- name: legacy-cli\n  binary: echo\n');
    writeFileSync(join(home, '.opencli', 'apps.yaml'), 'apps:\n  legacy-app:\n    port: 9229\n    processName: Legacy\n');
  });

  afterAll(() => rmSync(home, { recursive: true, force: true }));

  it('excludes removed adapters from discovery and fast completions', async () => {
    const listed = await runCli(['--help', '-f', 'json'], { env });
    expect(listed.code).toBe(0);
    const sites = parseJsonOutput(listed.stdout).site_adapters.sites;
    expect(sites).toContain('hackernews');
    for (const site of removedSites) expect(sites).not.toContain(site);

    const completed = await runCli(['--get-completions', '--cursor', '0'], { env });
    expect(completed.code).toBe(0);
    const candidates = completed.stdout.trim().split('\n');
    expect(candidates).toContain('hackernews');
    for (const name of [...removedSites, 'external', 'legacy-cli', 'legacy-app']) {
      expect(candidates).not.toContain(name);
    }
  });

  it('lists browser skills without sitemap guidance', async () => {
    const result = await runCli(['skills', 'list', '-f', 'json'], { env });
    expect(result.code).toBe(0);
    const names = parseJsonOutput(result.stdout).map((entry: { name: string }) => entry.name);
    expect(names).toContain('opencli-browser');
    expect(names).not.toContain('opencli-browser-sitemap');
    expect(names).not.toContain('opencli-sitemap-author');
  });

  it('publishes only website adapters in structured root help', async () => {
    const result = await runCli(['--help', '-f', 'json'], { env });
    expect(result.code).toBe(0);
    const help = parseJsonOutput(result.stdout);
    expect(help.site_adapters.sites).toContain('hackernews');
    expect(help).not.toHaveProperty('app_adapters');
    expect(help).not.toHaveProperty('external_clis');
    expect(help.commands.map((entry: { name: string }) => entry.name)).not.toContain('external');
  });

  it('clears removed official overrides during upgrade and preserves custom sites', () => {
    const configDir = join(home, '.opencli');
    const oldFiles = [...removedSites.map(site => `${site}/status.js`), '_shared/desktop-commands.js'];
    for (const file of oldFiles) {
      const target = join(configDir, 'clis', file);
      mkdirSync(join(target, '..'), { recursive: true });
      writeFileSync(target, '// Old official adapter');
    }
    const customDir = join(configDir, 'clis', 'my-custom-site');
    mkdirSync(customDir, { recursive: true });
    writeFileSync(join(customDir, 'hello.js'), '// User-created adapter');
    writeFileSync(join(configDir, 'adapter-manifest.json'), JSON.stringify({
      version: '0.0.0', files: oldFiles, hashes: {},
    }));

    execFileSync(process.execPath, [fileURLToPath(new URL('../../scripts/fetch-adapters.js', import.meta.url))], {
      env: { ...process.env, ...env, CI: '', CONTINUOUS_INTEGRATION: '', OPENCLI_FETCH: '1' },
    });

    for (const file of oldFiles) expect(existsSync(join(configDir, 'clis', file))).toBe(false);
    expect(readFileSync(join(customDir, 'hello.js'), 'utf8')).toBe('// User-created adapter');
    const manifest = JSON.parse(readFileSync(join(configDir, 'adapter-manifest.json'), 'utf8'));
    for (const file of oldFiles) expect(manifest.files).not.toContain(file);
  });

  it.each([...removedSites, 'external', 'gh', 'docker', 'legacy-cli', 'legacy-app', 'sitemap'])(
    'rejects the removed or legacy command %s', async (name) => {
      const result = await runCli([name], { env });
      expect(result.code).toBe(2);
      expect(JSON.parse(result.stdout).ok).toBe(false);
    },
  );
});
