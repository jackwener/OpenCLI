import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { enforceRateLimit, loadRateLimitRules } from './rate-limit.js';
import { ConfigError, RateLimitError } from './errors.js';

describe('rate-limit', () => {
  it('does nothing when the config file is absent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-rate-limit-'));

    expect(() => enforceRateLimit('xiaohongshu/delete-note', {
      configPath: path.join(dir, 'missing.yaml'),
      statePath: path.join(dir, 'state.json'),
      now: 1_000,
    })).not.toThrow();
  });

  it('blocks attempts above the configured sliding window limit', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-rate-limit-'));
    const configPath = path.join(dir, 'rate-limits.yaml');
    const statePath = path.join(dir, 'state.json');
    fs.writeFileSync(configPath, [
      'rules:',
      '  - command: xiaohongshu/delete-note',
      '    limit: 2',
      '    window: 10s',
      '',
    ].join('\n'), 'utf-8');

    enforceRateLimit('xiaohongshu/delete-note', { configPath, statePath, now: 1_000 });
    enforceRateLimit('xiaohongshu/delete-note', { configPath, statePath, now: 2_000 });

    expect(() => enforceRateLimit('xiaohongshu/delete-note', { configPath, statePath, now: 3_000 }))
      .toThrow(RateLimitError);
  });

  it('allows a command again after the oldest attempt leaves the window', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-rate-limit-'));
    const configPath = path.join(dir, 'rate-limits.yaml');
    const statePath = path.join(dir, 'state.json');
    fs.writeFileSync(configPath, [
      'rules:',
      '  - command: tiktok/unfollow',
      '    limit: 1',
      '    window: 5s',
      '',
    ].join('\n'), 'utf-8');

    enforceRateLimit('tiktok/unfollow', { configPath, statePath, now: 1_000 });
    enforceRateLimit('tiktok/unfollow', { configPath, statePath, now: 6_001 });

    const state = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as { commands: Record<string, number[]> };
    expect(state.commands['tiktok/unfollow']).toEqual([6_001]);
  });

  it('rejects invalid YAML config', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-rate-limit-'));
    const configPath = path.join(dir, 'rate-limits.yaml');
    fs.writeFileSync(configPath, 'rules:\n  - command: [', 'utf-8');

    expect(() => loadRateLimitRules(configPath)).toThrow(ConfigError);
  });

  it('rejects invalid rule fields', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencli-rate-limit-'));
    const configPath = path.join(dir, 'rate-limits.yaml');
    fs.writeFileSync(configPath, [
      'rules:',
      '  - command: gh',
      '    limit: 0',
      '    window: soon',
      '',
    ].join('\n'), 'utf-8');

    expect(() => loadRateLimitRules(configPath)).toThrow(ConfigError);
  });
});
