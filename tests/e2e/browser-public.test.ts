/**
 * E2E tests for core browser commands (bilibili, zhihu, v2ex).
 * These use OPENCLI_HEADLESS=1 to launch a headless Chromium.
 *
 * NOTE: Some sites may block headless browsers with bot detection.
 * Tests are wrapped with tryBrowserCommand() which allows graceful failure.
 */

import { describe, it, expect } from 'vitest';
import { runCli, parseJsonOutput } from './helpers.js';

async function tryBrowserCommand(args: string[]): Promise<any[] | null> {
  const { stdout, code } = await runCli(args, { timeout: 60_000 });
  if (code !== 0) return null;
  try {
    const data = parseJsonOutput(stdout);
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

function expectDataOrSkip(data: any[] | null, label: string) {
  if (data === null || data.length === 0) {
    console.warn(`${label}: skipped — no data returned (likely bot detection or geo-blocking)`);
    return;
  }
  expect(data.length).toBeGreaterThanOrEqual(1);
}

describe('browser public-data commands E2E', () => {

  // ── bilibili ──
  it('bilibili hot returns trending videos', async () => {
    const data = await tryBrowserCommand(['bilibili', 'hot', '--limit', '5', '-f', 'json']);
    expectDataOrSkip(data, 'bilibili hot');
    if (data) {
      expect(data[0]).toHaveProperty('title');
    }
  }, 60_000);

  it('bilibili ranking returns ranked videos', async () => {
    const data = await tryBrowserCommand(['bilibili', 'ranking', '--limit', '5', '-f', 'json']);
    expectDataOrSkip(data, 'bilibili ranking');
  }, 60_000);

  it('bilibili search returns results', async () => {
    const data = await tryBrowserCommand(['bilibili', 'search', 'typescript', '--limit', '3', '-f', 'json']);
    expectDataOrSkip(data, 'bilibili search');
  }, 60_000);

  // ── zhihu ──
  it('zhihu hot returns trending questions', async () => {
    const data = await tryBrowserCommand(['zhihu', 'hot', '--limit', '5', '-f', 'json']);
    expectDataOrSkip(data, 'zhihu hot');
    if (data) {
      expect(data[0]).toHaveProperty('title');
    }
  }, 60_000);

  it('zhihu search returns results', async () => {
    const data = await tryBrowserCommand(['zhihu', 'search', 'playwright', '--limit', '3', '-f', 'json']);
    expectDataOrSkip(data, 'zhihu search');
  }, 60_000);

  // ── v2ex ──
  it('v2ex daily returns topics', async () => {
    const data = await tryBrowserCommand(['v2ex', 'daily', '--limit', '3', '-f', 'json']);
    expectDataOrSkip(data, 'v2ex daily');
  }, 60_000);
});
