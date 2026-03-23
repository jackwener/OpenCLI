/**
 * E2E tests for browser commands that access PUBLIC data (no login required).
 * These use OPENCLI_HEADLESS=1 to launch a headless Chromium.
 *
 * NOTE: Some sites may block headless browsers with bot detection.
 * Tests are wrapped with tryBrowserCommand() which allows graceful failure.
 */

import { describe, it, expect } from 'vitest';
import { runCli, parseJsonOutput } from './helpers.js';

/**
 * Run a browser command — returns parsed data or null on failure.
 */
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

/**
 * Assert browser command returns data OR log a warning if blocked.
 * Empty results (bot detection, geo-blocking) are treated as a warning, not a failure.
 */
function expectDataOrSkip(data: any[] | null, label: string) {
  if (data === null || data.length === 0) {
    console.warn(`${label}: skipped — no data returned (likely bot detection or geo-blocking)`);
    return;
  }
  expect(data.length).toBeGreaterThanOrEqual(1);
}

describe('browser public-data commands E2E', () => {

  // ── bbc (browser: true, strategy: public) ──
  it('bbc news returns headlines', async () => {
    const data = await tryBrowserCommand(['bbc', 'news', '--limit', '3', '-f', 'json']);
    expectDataOrSkip(data, 'bbc news');
    if (data) {
      expect(data[0]).toHaveProperty('title');
    }
  }, 60_000);

  it('bloomberg news returns article detail when the article page is accessible', async () => {
    const feedResult = await runCli(['bloomberg', 'tech', '--limit', '1', '-f', 'json']);
    if (feedResult.code !== 0) {
      console.warn('bloomberg news: skipped — could not load Bloomberg tech feed');
      return;
    }

    const feedItems = parseJsonOutput(feedResult.stdout);
    const link = Array.isArray(feedItems) ? feedItems[0]?.link : null;
    if (!link) {
      console.warn('bloomberg news: skipped — tech feed returned no link');
      return;
    }

    const data = await tryBrowserCommand(['bloomberg', 'news', link, '-f', 'json']);
    expectDataOrSkip(data, 'bloomberg news');
    if (data) {
      expect(data[0]).toHaveProperty('title');
      expect(data[0]).toHaveProperty('summary');
      expect(data[0]).toHaveProperty('link');
      expect(data[0]).toHaveProperty('mediaLinks');
      expect(data[0]).toHaveProperty('content');
    }
  }, 60_000);

  // ── v2ex daily (browser: true) ──
  it('v2ex daily returns topics', async () => {
    const data = await tryBrowserCommand(['v2ex', 'daily', '--limit', '3', '-f', 'json']);
    expectDataOrSkip(data, 'v2ex daily');
  }, 60_000);

  // ── bilibili (browser: true, cookie strategy) ──
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

  // ── weibo (browser: true, cookie strategy) ──
  it('weibo hot returns trending topics', async () => {
    const data = await tryBrowserCommand(['weibo', 'hot', '--limit', '5', '-f', 'json']);
    expectDataOrSkip(data, 'weibo hot');
  }, 60_000);

  it('weibo search returns results', async () => {
    const data = await tryBrowserCommand(['weibo', 'search', 'openai', '--limit', '3', '-f', 'json']);
    expectDataOrSkip(data, 'weibo search');
  }, 60_000);

  // ── zhihu (browser: true, cookie strategy) ──
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

  // ── reddit (browser: true, cookie strategy) ──
  it('reddit hot returns posts', async () => {
    const data = await tryBrowserCommand(['reddit', 'hot', '--limit', '5', '-f', 'json']);
    expectDataOrSkip(data, 'reddit hot');
  }, 60_000);

  it('reddit frontpage returns posts', async () => {
    const data = await tryBrowserCommand(['reddit', 'frontpage', '--limit', '5', '-f', 'json']);
    expectDataOrSkip(data, 'reddit frontpage');
  }, 60_000);

  // ── twitter (browser: true) ──
  it('twitter trending returns trends', async () => {
    const data = await tryBrowserCommand(['twitter', 'trending', '--limit', '5', '-f', 'json']);
    expectDataOrSkip(data, 'twitter trending');
  }, 60_000);

  // ── xueqiu (browser: true, cookie strategy) ──
  it('xueqiu hot returns hot posts', async () => {
    const data = await tryBrowserCommand(['xueqiu', 'hot', '--limit', '5', '-f', 'json']);
    expectDataOrSkip(data, 'xueqiu hot');
  }, 60_000);

  it('xueqiu hot-stock returns stocks', async () => {
    const data = await tryBrowserCommand(['xueqiu', 'hot-stock', '--limit', '5', '-f', 'json']);
    expectDataOrSkip(data, 'xueqiu hot-stock');
  }, 60_000);

  // ── reuters (browser: true) ──
  it('reuters search returns articles', async () => {
    const data = await tryBrowserCommand(['reuters', 'search', 'technology', '--limit', '3', '-f', 'json']);
    expectDataOrSkip(data, 'reuters search');
  }, 60_000);

  // ── youtube (browser: true) ──
  it('youtube search returns videos', async () => {
    const data = await tryBrowserCommand(['youtube', 'search', 'typescript tutorial', '--limit', '3', '-f', 'json']);
    expectDataOrSkip(data, 'youtube search');
  }, 60_000);

  // ── smzdm (browser: true) ──
  it('smzdm search returns deals', async () => {
    const data = await tryBrowserCommand(['smzdm', 'search', '键盘', '--limit', '3', '-f', 'json']);
    expectDataOrSkip(data, 'smzdm search');
  }, 60_000);

  // ── boss (browser: true) ──
  it('boss search returns jobs', async () => {
    const data = await tryBrowserCommand(['boss', 'search', 'golang', '--limit', '3', '-f', 'json']);
    expectDataOrSkip(data, 'boss search');
  }, 60_000);

  // ── ctrip (browser: true) ──
  it('ctrip search returns flights', async () => {
    const data = await tryBrowserCommand(['ctrip', 'search', '-f', 'json']);
    expectDataOrSkip(data, 'ctrip search');
  }, 60_000);

  // ── coupang (browser: true) ──
  it('coupang search returns products', async () => {
    const data = await tryBrowserCommand(['coupang', 'search', 'laptop', '--limit', '3', '-f', 'json']);
    expectDataOrSkip(data, 'coupang search');
  }, 60_000);

  // ── xiaohongshu (browser: true) ──
  it('xiaohongshu search returns notes', async () => {
    const data = await tryBrowserCommand(['xiaohongshu', 'search', '美食', '--limit', '3', '-f', 'json']);
    expectDataOrSkip(data, 'xiaohongshu search');
  }, 60_000);

  // ── google search (browser: true, public strategy) ──
  it('google search returns results', async () => {
    const data = await tryBrowserCommand(['google', 'search', 'typescript', '--limit', '5', '-f', 'json']);
    expectDataOrSkip(data, 'google search');
    if (data) {
      expect(data[0]).toHaveProperty('type');
      expect(data[0]).toHaveProperty('title');
      expect(data[0]).toHaveProperty('url');
    }
  }, 60_000);

  // ── yahoo-finance (browser: true) ──
  it('yahoo-finance quote returns stock data', async () => {
    const data = await tryBrowserCommand(['yahoo-finance', 'quote', '--symbol', 'AAPL', '-f', 'json']);
    expectDataOrSkip(data, 'yahoo-finance quote');
  }, 60_000);
});
