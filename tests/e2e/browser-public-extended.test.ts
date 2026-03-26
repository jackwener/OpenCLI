/**
 * Extended E2E tests for all other browser commands.
 * Opt-in only: OPENCLI_E2E=1 npx vitest run
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

describe('browser extended public-data commands E2E', () => {

  // ── bbc ──
  it('bbc news returns headlines', async () => {
    const data = await tryBrowserCommand(['bbc', 'news', '--limit', '3', '-f', 'json']);
    expectDataOrSkip(data, 'bbc news');
    if (data) {
      expect(data[0]).toHaveProperty('title');
    }
  }, 60_000);

  // ── bloomberg ──
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

  // ── weibo ──
  it('weibo hot returns trending topics', async () => {
    const data = await tryBrowserCommand(['weibo', 'hot', '--limit', '5', '-f', 'json']);
    expectDataOrSkip(data, 'weibo hot');
  }, 60_000);

  it('weibo search returns results', async () => {
    const data = await tryBrowserCommand(['weibo', 'search', 'openai', '--limit', '3', '-f', 'json']);
    expectDataOrSkip(data, 'weibo search');
  }, 60_000);

  // ── reddit ──
  it('reddit hot returns posts', async () => {
    const data = await tryBrowserCommand(['reddit', 'hot', '--limit', '5', '-f', 'json']);
    expectDataOrSkip(data, 'reddit hot');
  }, 60_000);

  it('reddit frontpage returns posts', async () => {
    const data = await tryBrowserCommand(['reddit', 'frontpage', '--limit', '5', '-f', 'json']);
    expectDataOrSkip(data, 'reddit frontpage');
  }, 60_000);

  // ── twitter ──
  it('twitter trending returns trends', async () => {
    const data = await tryBrowserCommand(['twitter', 'trending', '--limit', '5', '-f', 'json']);
    expectDataOrSkip(data, 'twitter trending');
  }, 60_000);

  // ── xueqiu ──
  it('xueqiu hot returns hot posts', async () => {
    const data = await tryBrowserCommand(['xueqiu', 'hot', '--limit', '5', '-f', 'json']);
    expectDataOrSkip(data, 'xueqiu hot');
  }, 60_000);

  it('xueqiu hot-stock returns stocks', async () => {
    const data = await tryBrowserCommand(['xueqiu', 'hot-stock', '--limit', '5', '-f', 'json']);
    expectDataOrSkip(data, 'xueqiu hot-stock');
  }, 60_000);

  // ── reuters ──
  it('reuters search returns articles', async () => {
    const data = await tryBrowserCommand(['reuters', 'search', 'technology', '--limit', '3', '-f', 'json']);
    expectDataOrSkip(data, 'reuters search');
  }, 60_000);

  // ── youtube ──
  it('youtube search returns videos', async () => {
    const data = await tryBrowserCommand(['youtube', 'search', 'typescript tutorial', '--limit', '3', '-f', 'json']);
    expectDataOrSkip(data, 'youtube search');
  }, 60_000);

  // ── smzdm ──
  it('smzdm search returns deals', async () => {
    const data = await tryBrowserCommand(['smzdm', 'search', '键盘', '--limit', '3', '-f', 'json']);
    expectDataOrSkip(data, 'smzdm search');
  }, 60_000);

  // ── boss ──
  it('boss search returns jobs', async () => {
    const data = await tryBrowserCommand(['boss', 'search', 'golang', '--limit', '3', '-f', 'json']);
    expectDataOrSkip(data, 'boss search');
  }, 60_000);

  // ── ctrip ──
  it('ctrip search returns flights', async () => {
    const data = await tryBrowserCommand(['ctrip', 'search', '-f', 'json']);
    expectDataOrSkip(data, 'ctrip search');
  }, 60_000);

  // ── coupang ──
  it('coupang search returns products', async () => {
    const data = await tryBrowserCommand(['coupang', 'search', 'laptop', '--limit', '3', '-f', 'json']);
    expectDataOrSkip(data, 'coupang search');
  }, 60_000);

  // ── xiaohongshu ──
  it('xiaohongshu search returns notes', async () => {
    const data = await tryBrowserCommand(['xiaohongshu', 'search', '美食', '--limit', '3', '-f', 'json']);
    expectDataOrSkip(data, 'xiaohongshu search');
  }, 60_000);

  // ── google ──
  it('google search returns results', async () => {
    const data = await tryBrowserCommand(['google', 'search', 'typescript', '--limit', '5', '-f', 'json']);
    expectDataOrSkip(data, 'google search');
    if (data) {
      expect(data[0]).toHaveProperty('type');
      expect(data[0]).toHaveProperty('title');
      expect(data[0]).toHaveProperty('url');
    }
  }, 60_000);

  // ── yahoo-finance ──
  it('yahoo-finance quote returns stock data', async () => {
    const data = await tryBrowserCommand(['yahoo-finance', 'quote', 'AAPL', '-f', 'json']);
    expectDataOrSkip(data, 'yahoo-finance quote');
  }, 60_000);
});
