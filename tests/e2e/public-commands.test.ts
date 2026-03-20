/**
 * E2E tests for public API commands (browser: false).
 * These commands use Node.js fetch directly — no browser needed.
 */

import { describe, it, expect } from 'vitest';
import { runCli, parseJsonOutput } from './helpers.js';

function isExpectedChineseSiteRestriction(code: number, stderr: string): boolean {
  if (code === 0) return false;
  return /Error \[FETCH_ERROR\]: HTTP (403|429|451|503)\b/.test(stderr);
}

// Keep old name as alias for existing tests
const isExpectedXiaoyuzhouRestriction = isExpectedChineseSiteRestriction;

describe('public commands E2E', () => {
  // ── bloomberg (RSS-backed, browser: false) ──
  it('bloomberg main returns structured headline data', async () => {
    const { stdout, code } = await runCli(['bloomberg', 'main', '--limit', '1', '-f', 'json']);
    expect(code).toBe(0);
    const data = parseJsonOutput(stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(1);
    expect(data[0]).toHaveProperty('title');
    expect(data[0]).toHaveProperty('summary');
    expect(data[0]).toHaveProperty('link');
    expect(data[0]).toHaveProperty('mediaLinks');
    expect(Array.isArray(data[0].mediaLinks)).toBe(true);
  }, 30_000);

  it.each(['markets', 'economics', 'industries', 'tech', 'politics', 'businessweek', 'opinions'])(
    'bloomberg %s returns structured RSS items',
    async (section) => {
      const { stdout, code } = await runCli(['bloomberg', section, '--limit', '1', '-f', 'json']);
      expect(code).toBe(0);
      const data = parseJsonOutput(stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(1);
      expect(data[0]).toHaveProperty('title');
      expect(data[0]).toHaveProperty('summary');
      expect(data[0]).toHaveProperty('link');
      expect(data[0]).toHaveProperty('mediaLinks');
    },
    30_000,
  );

  it('bloomberg feeds lists the supported RSS aliases', async () => {
    const { stdout, code } = await runCli(['bloomberg', 'feeds', '-f', 'json']);
    expect(code).toBe(0);
    const data = parseJsonOutput(stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'main' }),
        expect.objectContaining({ name: 'markets' }),
        expect.objectContaining({ name: 'tech' }),
        expect.objectContaining({ name: 'opinions' }),
      ]),
    );
  }, 30_000);

  // ── apple-podcasts ──
  it('apple-podcasts search returns structured podcast results', async () => {
    const { stdout, code } = await runCli(['apple-podcasts', 'search', 'technology', '--limit', '3', '-f', 'json']);
    expect(code).toBe(0);
    const data = parseJsonOutput(stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0]).toHaveProperty('id');
    expect(data[0]).toHaveProperty('title');
    expect(data[0]).toHaveProperty('author');
  }, 30_000);

  it('apple-podcasts episodes returns episode list from a known show', async () => {
    const { stdout, code } = await runCli(['apple-podcasts', 'episodes', '275699983', '--limit', '3', '-f', 'json']);
    expect(code).toBe(0);
    const data = parseJsonOutput(stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0]).toHaveProperty('title');
    expect(data[0]).toHaveProperty('duration');
    expect(data[0]).toHaveProperty('date');
  }, 30_000);

  it('apple-podcasts top returns ranked podcasts', async () => {
    const { stdout, code } = await runCli(['apple-podcasts', 'top', '--limit', '3', '--country', 'us', '-f', 'json']);
    expect(code).toBe(0);
    const data = parseJsonOutput(stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(3);
    expect(data[0]).toHaveProperty('rank');
    expect(data[0]).toHaveProperty('title');
    expect(data[0]).toHaveProperty('id');
  }, 30_000);

  // ── hackernews ──
  it('hackernews top returns structured data', async () => {
    const { stdout, code } = await runCli(['hackernews', 'top', '--limit', '3', '-f', 'json']);
    expect(code).toBe(0);
    const data = parseJsonOutput(stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(3);
    expect(data[0]).toHaveProperty('title');
    expect(data[0]).toHaveProperty('score');
    expect(data[0]).toHaveProperty('rank');
  }, 30_000);

  it('hackernews top respects --limit', async () => {
    const { stdout, code } = await runCli(['hackernews', 'top', '--limit', '1', '-f', 'json']);
    expect(code).toBe(0);
    const data = parseJsonOutput(stdout);
    expect(data.length).toBe(1);
  }, 30_000);

  // ── v2ex (public API, browser: false) ──
  it('v2ex hot returns topics', async () => {
    const { stdout, code } = await runCli(['v2ex', 'hot', '--limit', '3', '-f', 'json']);
    expect(code).toBe(0);
    const data = parseJsonOutput(stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0]).toHaveProperty('title');
  }, 30_000);

  it('v2ex latest returns topics', async () => {
    const { stdout, code } = await runCli(['v2ex', 'latest', '--limit', '3', '-f', 'json']);
    expect(code).toBe(0);
    const data = parseJsonOutput(stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it('v2ex topic returns topic detail', async () => {
    // Topic 1000001 is a well-known V2EX topic
    const { stdout, code } = await runCli(['v2ex', 'topic', '--id', '1000001', '-f', 'json']);
    // May fail if V2EX rate-limits, but should return structured data
    if (code === 0) {
      const data = parseJsonOutput(stdout);
      expect(data).toBeDefined();
    }
  }, 30_000);

  // ── xiaoyuzhou (Chinese site — may return empty on overseas CI runners) ──
  it('xiaoyuzhou podcast returns podcast profile', async () => {
    const { stdout, stderr, code } = await runCli(['xiaoyuzhou', 'podcast', '6013f9f58e2f7ee375cf4216', '-f', 'json']);
    if (isExpectedXiaoyuzhouRestriction(code, stderr)) {
      console.warn(`xiaoyuzhou podcast skipped: ${stderr.trim()}`);
      return;
    }
    expect(code).toBe(0);
    const data = parseJsonOutput(stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(1);
    expect(data[0]).toHaveProperty('title');
    expect(data[0]).toHaveProperty('subscribers');
    expect(data[0]).toHaveProperty('episodes');
  }, 30_000);

  it('xiaoyuzhou podcast-episodes returns episode list', async () => {
    const { stdout, stderr, code } = await runCli(['xiaoyuzhou', 'podcast-episodes', '6013f9f58e2f7ee375cf4216', '-f', 'json']);
    if (isExpectedXiaoyuzhouRestriction(code, stderr)) {
      console.warn(`xiaoyuzhou podcast-episodes skipped: ${stderr.trim()}`);
      return;
    }
    expect(code).toBe(0);
    const data = parseJsonOutput(stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0]).toHaveProperty('eid');
    expect(data[0]).toHaveProperty('title');
    expect(data[0]).toHaveProperty('duration');
  }, 30_000);

  it('xiaoyuzhou episode returns episode detail', async () => {
    const { stdout, stderr, code } = await runCli(['xiaoyuzhou', 'episode', '69b3b675772ac2295bfc01d0', '-f', 'json']);
    if (isExpectedXiaoyuzhouRestriction(code, stderr)) {
      console.warn(`xiaoyuzhou episode skipped: ${stderr.trim()}`);
      return;
    }
    expect(code).toBe(0);
    const data = parseJsonOutput(stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(1);
    expect(data[0]).toHaveProperty('title');
    expect(data[0]).toHaveProperty('podcast');
    expect(data[0]).toHaveProperty('plays');
    expect(data[0]).toHaveProperty('comments');
  }, 30_000);

  it('xiaoyuzhou podcast-episodes rejects invalid limit', async () => {
    const { stderr, code } = await runCli(['xiaoyuzhou', 'podcast-episodes', '6013f9f58e2f7ee375cf4216', '--limit', 'abc', '-f', 'json']);
    if (isExpectedXiaoyuzhouRestriction(code, stderr)) {
      console.warn(`xiaoyuzhou invalid-limit skipped: ${stderr.trim()}`);
      return;
    }
    expect(code).not.toBe(0);
    expect(stderr).toMatch(/limit must be a positive integer|Argument "limit" must be a valid number/);
  }, 30_000);

  // ── weread (Chinese site — may return empty on overseas CI runners) ──
  it('weread search returns books', async () => {
    const { stdout, stderr, code } = await runCli(['weread', 'search', 'python', '--limit', '3', '-f', 'json']);
    if (isExpectedChineseSiteRestriction(code, stderr)) {
      console.warn(`weread search skipped: ${stderr.trim()}`);
      return;
    }
    expect(code).toBe(0);
    const data = parseJsonOutput(stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0]).toHaveProperty('title');
    expect(data[0]).toHaveProperty('bookId');
  }, 30_000);

  it('weread ranking returns books', async () => {
    const { stdout, stderr, code } = await runCli(['weread', 'ranking', 'all', '--limit', '3', '-f', 'json']);
    if (isExpectedChineseSiteRestriction(code, stderr)) {
      console.warn(`weread ranking skipped: ${stderr.trim()}`);
      return;
    }
    expect(code).toBe(0);
    const data = parseJsonOutput(stdout);
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThanOrEqual(1);
    expect(data[0]).toHaveProperty('title');
    expect(data[0]).toHaveProperty('readingCount');
    expect(data[0]).toHaveProperty('bookId');
  }, 30_000);
});
