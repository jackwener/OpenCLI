/**
 * E2E tests for core browser commands (bilibili, zhihu, v2ex, IMDb).
 * These launch a headless Chromium in CI.
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

function isBaiduChallengeText(text: string): boolean {
  return /百度安全验证|安全验证|请完成验证|captcha/i.test(text);
}

function isBaiduChallenge(result: CliResult): boolean {
  const text = `${result.stderr}\n${result.stdout}`;
  return isBaiduChallengeText(text);
}

function isTransientBrowserDetach(result: CliResult): boolean {
  const text = `${result.stderr}\n${result.stdout}`;
  return /Detached while handling command|No tab with id|Debugger is not attached to the tab/i.test(text);
}

async function runCliWithTransientRetry(args: string[], timeout: number): Promise<CliResult> {
  let result = await runCli(args, { timeout });
  if (result.code !== 0 && isTransientBrowserDetach(result)) {
    result = await runCli(args, { timeout });
  }
  return result;
}

async function runJsonCliOrThrow(args: string[], label: string, timeout: number, opts: { retryTransient?: boolean } = {}): Promise<any[] | null> {
  const result = opts.retryTransient
    ? await runCliWithTransientRetry(args, timeout)
    : await runCli(args, { timeout });
  if (result.code !== 0) {
    if (isBrowserBridgeUnavailable(result)) {
      console.warn(`${label}: skipped — Browser Bridge extension is unavailable in this environment`);
      return null;
    }
    if (isBaiduChallenge(result)) {
      console.warn(`${label}: skipped — Baidu challenge page detected`);
      return null;
    }
    throw new Error(`${label} failed:\n${result.stderr || result.stdout}`);
  }

  const data = parseJsonOutput(result.stdout);
  if (!Array.isArray(data)) {
    throw new Error(`${label} returned non-array JSON:\n${result.stdout.slice(0, 500)}`);
  }
  return data;
}

function normalizeTiebaTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function hasTiebaMainPost(data: any[] | null): boolean {
  return Array.isArray(data) && data.some((item: any) => Number(item.floor) === 1);
}

function expectNonEmptyDataOrSkipEnv(data: any[] | null, label: string): data is any[] {
  if (data === null) {
    console.warn(`${label}: skipped — environment is unavailable for browser assertions`);
    return false;
  }
  expect(data.length).toBeGreaterThanOrEqual(1);
  return true;
}

function countTiebaReplies(data: any[] | null): number {
  if (!Array.isArray(data)) return 0;
  return data.filter((item: any) => Number(item.floor) > 1).length;
}

function maxTiebaFloor(data: any[] | null): number {
  if (!Array.isArray(data) || !data.length) return 0;
  return Math.max(...data.map((item: any) => Number(item.floor) || 0));
}

function getTiebaReplyFloors(data: any[] | null): number[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((item: any) => Number(item.floor) || 0)
    .filter((floor) => floor > 1);
}

function countTiebaReplyFloorOverlap(left: any[] | null, right: any[] | null): number {
  const rightFloors = new Set(getTiebaReplyFloors(right));
  return getTiebaReplyFloors(left).filter((floor) => rightFloors.has(floor)).length;
}

function pickTiebaReadCandidates(
  posts: any[] | null,
  minReplies: number,
): Array<{ threadId: string; title: string; replies: number }> {
  if (!Array.isArray(posts) || !posts.length) return [];

  return [...posts]
    .filter((item: any) => item?.id)
    .map((item: any) => ({
      threadId: String(item.id || '').trim(),
      title: normalizeTiebaTitle(String(item.title || '')),
      replies: Number(item.replies) || 0,
    }))
    .filter((item) => item.threadId && item.title && item.replies >= minReplies)
    .sort((left, right) => right.replies - left.replies);
}

/**
 * Pick a live thread that actually exposes enough visible replies for the read assertions.
 */
async function getTiebaReadCandidateOrSkip(
  label: string,
  options: { minRepliesOnPage1?: number; requirePage2?: boolean } = {},
): Promise<{ threadId: string; title: string; replies: number } | null> {
  const minRepliesOnPage1 = Math.max(1, Number(options.minRepliesOnPage1 || 1));
  const requirePage2 = options.requirePage2 === true;
  const posts = await runJsonCliOrThrow(['tieba', 'posts', '李毅', '--limit', '10', '-f', 'json'], `${label} setup`, 90_000, {
    retryTransient: true,
  });
  if (posts === null) {
    return null;
  }
  if (!Array.isArray(posts) || !posts.length) {
    console.warn(`${label}: skipped — could not resolve Tieba posts for setup`);
    return null;
  }

  const minReplies = requirePage2 ? Math.max(minRepliesOnPage1, 50) : minRepliesOnPage1;
  const candidates = pickTiebaReadCandidates(posts, minReplies).slice(0, 5);
  if (!candidates.length) {
    console.warn(`${label}: skipped — could not find a Tieba thread with enough replies from posts metadata`);
    return null;
  }

  for (const candidate of candidates) {
    const page1Preview = await runJsonCliOrThrow(
      ['tieba', 'read', candidate.threadId, '--page', '1', '--limit', String(Math.max(minRepliesOnPage1, 2)), '-f', 'json'],
      `${label} preview page 1`,
      90_000,
      { retryTransient: true },
    );
    if (page1Preview === null) {
      return null;
    }
    if (!hasTiebaMainPost(page1Preview) || countTiebaReplies(page1Preview) < minRepliesOnPage1) {
      continue;
    }

    if (requirePage2) {
      const page2Preview = await runJsonCliOrThrow(
        ['tieba', 'read', candidate.threadId, '--page', '2', '--limit', '1', '-f', 'json'],
        `${label} preview page 2`,
        90_000,
        { retryTransient: true },
      );
      if (page2Preview === null) {
        return null;
      }
      if (hasTiebaMainPost(page2Preview) || countTiebaReplies(page2Preview) < 1) {
        continue;
      }
    }

    return candidate;
  }

  console.warn(`${label}: skipped — could not find a Tieba thread with enough visible replies`);
  return null;
}

describe('tieba e2e helper guards', () => {
  it('does not treat generic empty-result errors as a Baidu challenge', () => {
    expect(isBaiduChallengeText('tieba posts returned no data\n→ The page structure may have changed — this adapter may be outdated.')).toBe(false);
  });

  it('still recognizes actual Baidu challenge text', () => {
    expect(isBaiduChallengeText('百度安全验证，请完成验证后继续')).toBe(true);
  });

  it('counts partial overlap between read pages', () => {
    expect(countTiebaReplyFloorOverlap(
      [{ floor: 1 }, { floor: 23 }, { floor: 27 }, { floor: 28 }, { floor: 29 }, { floor: 30 }],
      [{ floor: 27 }, { floor: 28 }, { floor: 31 }],
    )).toBe(2);
  });

  it('picks read fixtures from posts metadata in descending reply order', () => {
    expect(pickTiebaReadCandidates([
      { id: '1', title: '普通帖', replies: 2 },
      { id: '2', title: '大帖', replies: 120 },
      { id: '', title: '无效帖', replies: 999 },
    ], 50)).toEqual([{
      threadId: '2',
      title: '大帖',
      replies: 120,
    }]);

    expect(pickTiebaReadCandidates([{ id: '1', title: '普通帖', replies: 2 }], 50)).toEqual([]);
  });
});

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

  // ── tieba ──
  it('tieba hot returns trending topics', async () => {
    const data = await runJsonCliOrThrow(['tieba', 'hot', '--limit', '5', '-f', 'json'], 'tieba hot', 60_000, { retryTransient: true });
    if (expectNonEmptyDataOrSkipEnv(data, 'tieba hot')) {
      expect(data[0]).toHaveProperty('title');
      expect(data[0]).toHaveProperty('discussions');
    }
  }, 60_000);

  it('tieba posts returns forum threads', async () => {
    const data = await runJsonCliOrThrow(['tieba', 'posts', '李毅', '--limit', '20', '-f', 'json'], 'tieba posts', 90_000, { retryTransient: true });
    if (expectNonEmptyDataOrSkipEnv(data, 'tieba posts')) {
      expect(data[0]).toHaveProperty('title');
      expect(String(data[0].id || '')).toMatch(/^\d+$/);
      expect(String(data[0].url || '')).toContain('/p/');
      expect(Number.isFinite(Number(data[0].replies))).toBe(true);
      expect(data.length).toBeLessThanOrEqual(20);
    }
  }, 90_000);

  it('tieba posts page 2 returns a different forum slice', async () => {
    const data1 = await runJsonCliOrThrow(['tieba', 'posts', '李毅', '--page', '1', '--limit', '5', '-f', 'json'], 'tieba posts page 1', 60_000, { retryTransient: true });
    const data2 = await runJsonCliOrThrow(['tieba', 'posts', '李毅', '--page', '2', '--limit', '5', '-f', 'json'], 'tieba posts page 2', 60_000, { retryTransient: true });
    if (expectNonEmptyDataOrSkipEnv(data1, 'tieba posts page 1') && expectNonEmptyDataOrSkipEnv(data2, 'tieba posts page 2')) {
      const ids1 = data1.map((item: any) => String(item.id || '')).filter(Boolean);
      const ids2 = data2.map((item: any) => String(item.id || '')).filter(Boolean);
      const newIds = ids2.filter((id) => !ids1.includes(id));
      expect(newIds.length).toBeGreaterThan(0);
    }
  }, 90_000);

  it('tieba search returns results', async () => {
    const data = await runJsonCliOrThrow(['tieba', 'search', '编程', '--limit', '20', '-f', 'json'], 'tieba search', 90_000, { retryTransient: true });
    if (expectNonEmptyDataOrSkipEnv(data, 'tieba search')) {
      expect(data[0]).toHaveProperty('title');
      expect(String(data[0].id || '')).toMatch(/^\d+$/);
      expect(String(data[0].url || '')).toContain('/p/');
      expect(data.length).toBeLessThanOrEqual(20);
    }
  }, 90_000);

  it('tieba search rejects unsupported pages above 1', async () => {
    const result = await runCli(['tieba', 'search', '编程', '--page', '2', '--limit', '3', '-f', 'json'], {
      timeout: 60_000,
    });
    expect(result.code).toBe(2);
    expect(`${result.stderr}\n${result.stdout}`).toContain('Argument "page" must be one of: 1');
  }, 60_000);

  it('tieba read returns thread content', async () => {
    const fixture = await getTiebaReadCandidateOrSkip('tieba read');
    if (!fixture) {
      return;
    }
    const data = await runJsonCliOrThrow(['tieba', 'read', fixture.threadId, '--limit', '5', '-f', 'json'], 'tieba read', 90_000, { retryTransient: true });
    if (expectNonEmptyDataOrSkipEnv(data, 'tieba read')) {
      expect(data[0]).toHaveProperty('floor');
      expect(data[0]).toHaveProperty('content');
      expect(data.some((item: any) => Number(item.floor) === 1)).toBe(true);
      expect(normalizeTiebaTitle(String(data[0].content || ''))).toContain(fixture.title);
    }
  }, 90_000);

  it('tieba read page 2 omits the main post', async () => {
    const fixture = await getTiebaReadCandidateOrSkip('tieba read page', { requirePage2: true });
    if (!fixture) {
      return;
    }
    const data1 = await runJsonCliOrThrow(['tieba', 'read', fixture.threadId, '--page', '1', '--limit', '5', '-f', 'json'], 'tieba read page 1', 90_000, { retryTransient: true });
    const data2 = await runJsonCliOrThrow(['tieba', 'read', fixture.threadId, '--page', '2', '--limit', '5', '-f', 'json'], 'tieba read page 2', 90_000, { retryTransient: true });
    if (expectNonEmptyDataOrSkipEnv(data1, 'tieba read page 1') && expectNonEmptyDataOrSkipEnv(data2, 'tieba read page 2')) {
      const overlap = countTiebaReplyFloorOverlap(data1, data2);
      expect(normalizeTiebaTitle(String(data1[0].content || ''))).toContain(fixture.title);
      expect(hasTiebaMainPost(data1)).toBe(true);
      expect(hasTiebaMainPost(data2)).toBe(false);
      expect(overlap).toBe(0);
      expect(maxTiebaFloor(data2)).toBeGreaterThan(maxTiebaFloor(data1));
    }
  }, 90_000);

  it('tieba read limit counts replies instead of consuming the main post slot', async () => {
    const fixture = await getTiebaReadCandidateOrSkip('tieba read limit semantics', { minRepliesOnPage1: 2 });
    if (!fixture) {
      return;
    }
    const data = await runJsonCliOrThrow(['tieba', 'read', fixture.threadId, '--page', '1', '--limit', '2', '-f', 'json'], 'tieba read limit semantics', 90_000, { retryTransient: true });
    if (expectNonEmptyDataOrSkipEnv(data, 'tieba read limit semantics')) {
      expect(normalizeTiebaTitle(String(data[0].content || ''))).toContain(fixture.title);
      expect(hasTiebaMainPost(data)).toBe(true);
      expect(countTiebaReplies(data)).toBe(2);
    }
  }, 90_000);

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
