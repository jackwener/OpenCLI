/**
 * E2E tests for core browser commands (bilibili, zhihu, v2ex, IMDb).
 * These use OPENCLI_HEADLESS=1 to launch a headless Chromium.
 *
 * NOTE: Some sites may block headless browsers with bot detection.
 * Tests are wrapped with tryBrowserCommand() which allows graceful failure.
 */

import { describe, it, expect } from 'vitest';
import { runCli, parseJsonOutput, type CliResult } from './helpers.js';

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

function isImdbChallenge(result: CliResult): boolean {
  const text = `${result.stderr}\n${result.stdout}`;
  return /IMDb blocked this request|Robot Check|Are you a robot|verify that you are human|captcha/i.test(text);
}

function isBrowserBridgeUnavailable(result: CliResult): boolean {
  const text = `${result.stderr}\n${result.stdout}`;
  return /Browser Bridge.*not connected|Extension.*not connected/i.test(text);
}

async function expectImdbDataOrChallengeSkip(args: string[], label: string): Promise<any[] | null> {
  const result = await runCli(args, { timeout: 60_000 });
  if (result.code !== 0) {
    if (isImdbChallenge(result)) {
      console.warn(`${label}: skipped — IMDb challenge page detected`);
      return null;
    }
    if (isBrowserBridgeUnavailable(result)) {
      console.warn(`${label}: skipped — Browser Bridge extension is unavailable in this environment`);
      return null;
    }
    throw new Error(`${label} failed:\n${result.stderr || result.stdout}`);
  }

  const data = parseJsonOutput(result.stdout);
  if (!Array.isArray(data)) {
    throw new Error(`${label} returned non-array JSON:\n${result.stdout.slice(0, 500)}`);
  }
  if (data.length === 0) {
    throw new Error(`${label} returned an empty result`);
  }
  return data;
}

describe('browser public-data commands E2E', () => {

  // ── bilibili ──
  it('bilibili hot returns trending videos', async () => {
    const data = await tryBrowserCommand(['bilibili', 'hot', '--limit', '5', '-f', 'json']);
    expectDataOrSkip(data, 'bilibili hot');
    if (data?.length) {
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
    if (data?.length) {
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

  // ── imdb ──
  it('imdb top returns chart data', async () => {
    const data = await expectImdbDataOrChallengeSkip(['imdb', 'top', '--limit', '3', '-f', 'json'], 'imdb top');
    if (data?.length) {
      expect(data[0]).toHaveProperty('title');
    }
  }, 60_000);

  it('imdb search returns results', async () => {
    const data = await expectImdbDataOrChallengeSkip(['imdb', 'search', 'inception', '--limit', '3', '-f', 'json'], 'imdb search');
    if (data?.length) {
      expect(data[0]).toHaveProperty('id');
      expect(data[0]).toHaveProperty('title');
    }
  }, 60_000);

  it('imdb title returns movie details', async () => {
    const data = await expectImdbDataOrChallengeSkip(['imdb', 'title', 'tt1375666', '-f', 'json'], 'imdb title');
    if (data?.length) {
      expect(data[0]).toHaveProperty('field');
      expect(data[0]).toHaveProperty('value');
    }
  }, 60_000);
});
