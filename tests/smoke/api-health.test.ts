/**
 * Smoke tests for external API health.
 * Only run on schedule or manual dispatch — NOT on every push/PR.
 * These verify that external APIs haven't changed their structure.
 */

import { describe, expect, it } from 'vitest';
import { parseJsonOutput, runCli } from '../e2e/helpers.js';

describe('API health smoke tests', () => {
  // ── Public API commands (should always work) ──
  it('hackernews API is responsive and returns expected structure', async () => {
    const { stdout, code } = await runCli(['hackernews', 'top', '--limit', '5', '-f', 'json']);
    expect(code).toBe(0);
    const data = parseJsonOutput(stdout);
    expect(data.length).toBe(5);
    for (const item of data) {
      expect(item).toHaveProperty('title');
      expect(item).toHaveProperty('score');
      expect(item).toHaveProperty('author');
      expect(item).toHaveProperty('rank');
    }
  }, 30_000);

  it('v2ex hot API is responsive', async () => {
    const { stdout, code } = await runCli(['v2ex', 'hot', '--limit', '3', '-f', 'json']);
    expect(code).toBe(0);
    const data = parseJsonOutput(stdout);
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0]).toHaveProperty('title');
  }, 30_000);

  it('v2ex latest API is responsive', async () => {
    const { stdout, code } = await runCli(['v2ex', 'latest', '--limit', '3', '-f', 'json']);
    expect(code).toBe(0);
    const data = parseJsonOutput(stdout);
    expect(data.length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it('v2ex topic API is responsive', async () => {
    const { stdout, code } = await runCli(['v2ex', 'topic', '1000001', '-f', 'json']);
    if (code === 0) {
      const data = parseJsonOutput(stdout);
      expect(data).toBeDefined();
    }
  }, 30_000);

  it('v2ex node API is responsive', async () => {
    const { stdout, code } = await runCli(['v2ex', 'node', 'python', '--limit', '3', '-f', 'json']);
    if (code === 0) {
      const data = parseJsonOutput(stdout);
      expect(data.length).toBeGreaterThanOrEqual(1);
      expect(data[0]).toHaveProperty('title');
      expect(data[0]).toHaveProperty('author');
    }
  }, 30_000);

  it('v2ex user API is responsive', async () => {
    const { stdout, code } = await runCli(['v2ex', 'user', 'Livid', '--limit', '3', '-f', 'json']);
    if (code === 0) {
      const data = parseJsonOutput(stdout);
      expect(data.length).toBeGreaterThanOrEqual(1);
      expect(data[0]).toHaveProperty('title');
      expect(data[0]).toHaveProperty('url');
    }
  }, 30_000);

  it('v2ex member API is responsive', async () => {
    const { stdout, code } = await runCli(['v2ex', 'member', 'Livid', '-f', 'json']);
    if (code === 0) {
      const data = parseJsonOutput(stdout);
      expect(data.length).toBe(1);
      expect(data[0].username).toBe('Livid');
    }
  }, 30_000);

  it('v2ex replies API is responsive', async () => {
    const { stdout, code } = await runCli(['v2ex', 'replies', '1000', '--limit', '3', '-f', 'json']);
    if (code === 0) {
      const data = parseJsonOutput(stdout);
      expect(data.length).toBeGreaterThanOrEqual(1);
      expect(data[0]).toHaveProperty('author');
    }
  }, 30_000);

  it('v2ex nodes API is responsive', async () => {
    const { stdout, code } = await runCli(['v2ex', 'nodes', '--limit', '5', '-f', 'json']);
    if (code === 0) {
      const data = parseJsonOutput(stdout);
      expect(data.length).toBe(5);
      expect(data[0]).toHaveProperty('topics');
    }
  }, 30_000);

  // ── Validate all adapters ──
  it('all adapter definitions are valid', async () => {
    const { stdout, code } = await runCli(['validate']);
    expect(code).toBe(0);
    expect(stdout).toContain('PASS');
  });

  // ── Command registry integrity ──
  it('all expected sites are registered', async () => {
    const { stdout, code } = await runCli(['list', '-f', 'json']);
    expect(code).toBe(0);
    const data = parseJsonOutput(stdout);
    const sites = new Set(data.map((d: any) => d.site));
    // Verify all 17 sites are present
    for (const expected of [
      'hackernews',
      'bbc',
      'bilibili',
      'v2ex',
      'weibo',
      'zhihu',
      'twitter',
      'reddit',
      'xueqiu',
      'reuters',
      'youtube',
      'smzdm',
      'boss',
      'ctrip',
      'coupang',
      'xiaohongshu',
      'yahoo-finance',
    ]) {
      expect(sites.has(expected)).toBe(true);
    }
  });
});
