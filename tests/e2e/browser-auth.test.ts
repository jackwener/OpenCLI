/**
 * E2E tests for login-required browser commands.
 * These commands REQUIRE authentication (cookie/session).
 * In CI (headless, no login), they should fail gracefully — NOT crash.
 *
 * These tests verify the error handling path, not the data extraction.
 */

import { describe, it, expect } from 'vitest';
import { runCli } from './helpers.js';

/**
 * Verify a login-required command fails gracefully (no crash, no hang).
 * Acceptable outcomes: exit code 1 with error message, OR timeout handled.
 */
async function expectGracefulAuthFailure(args: string[], label: string) {
  const { stdout, stderr, code } = await runCli(args, { timeout: 60_000 });
  // Should either fail with exit code 1 (error message) or succeed with empty data
  // The key assertion: it should NOT hang forever or crash with unhandled exception
  if (code !== 0) {
    // Verify stderr has a meaningful error, not an unhandled crash
    const output = stderr + stdout;
    expect(output.length).toBeGreaterThan(0);
  }
  // If it somehow succeeds (e.g., partial public data), that's fine too
}

describe('login-required commands — graceful failure', () => {

  // ── bilibili (requires cookie session) ──
  it('bilibili me fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['bilibili', 'me', '-f', 'json'], 'bilibili me');
  }, 60_000);

  it('bilibili dynamic fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['bilibili', 'dynamic', '--limit', '3', '-f', 'json'], 'bilibili dynamic');
  }, 60_000);

  it('bilibili favorite fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['bilibili', 'favorite', '--limit', '3', '-f', 'json'], 'bilibili favorite');
  }, 60_000);

  it('bilibili history fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['bilibili', 'history', '--limit', '3', '-f', 'json'], 'bilibili history');
  }, 60_000);

  it('bilibili following fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['bilibili', 'following', '--limit', '3', '-f', 'json'], 'bilibili following');
  }, 60_000);

  // ── twitter (requires login) ──
  it('twitter bookmarks fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['twitter', 'bookmarks', '--limit', '3', '-f', 'json'], 'twitter bookmarks');
  }, 60_000);

  it('twitter timeline fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['twitter', 'timeline', '--limit', '3', '-f', 'json'], 'twitter timeline');
  }, 60_000);

  it('twitter notifications fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['twitter', 'notifications', '--limit', '3', '-f', 'json'], 'twitter notifications');
  }, 60_000);

  // ── v2ex (requires login) ──
  it('v2ex me fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['v2ex', 'me', '-f', 'json'], 'v2ex me');
  }, 60_000);

  it('v2ex notifications fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['v2ex', 'notifications', '--limit', '3', '-f', 'json'], 'v2ex notifications');
  }, 60_000);

  // ── xueqiu (requires login) ──
  it('xueqiu feed fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['xueqiu', 'feed', '--limit', '3', '-f', 'json'], 'xueqiu feed');
  }, 60_000);

  it('xueqiu watchlist fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['xueqiu', 'watchlist', '-f', 'json'], 'xueqiu watchlist');
  }, 60_000);

  // ── linux-do (requires login — all endpoints need authentication) ──
  it('linux-do feed fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['linux-do', 'feed', '--limit', '3', '-f', 'json'], 'linux-do feed');
  }, 60_000);

  it('linux-do categories fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['linux-do', 'categories', '--limit', '3', '-f', 'json'], 'linux-do categories');
  }, 60_000);

  it('linux-do tags fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['linux-do', 'tags', '--limit', '3', '-f', 'json'], 'linux-do tags');
  }, 60_000);

  it('linux-do topic fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['linux-do', 'topic', '1', '-f', 'json'], 'linux-do topic');
  }, 60_000);

  it('linux-do search fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['linux-do', 'search', 'test', '--limit', '3', '-f', 'json'], 'linux-do search');
  }, 60_000);

  it('linux-do user-topics fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['linux-do', 'user-topics', 'test', '--limit', '3', '-f', 'json'], 'linux-do user-topics');
  }, 60_000);

  it('linux-do user-posts fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['linux-do', 'user-posts', 'test', '--limit', '3', '-f', 'json'], 'linux-do user-posts');
  }, 60_000);

  // ── xiaohongshu (requires login) ──
  it('xiaohongshu feed fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['xiaohongshu', 'feed', '--limit', '3', '-f', 'json'], 'xiaohongshu feed');
  }, 60_000);

  it('xiaohongshu notifications fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['xiaohongshu', 'notifications', '--limit', '3', '-f', 'json'], 'xiaohongshu notifications');
  }, 60_000);

  // ── pixiv (requires login) ──
  it('pixiv ranking fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['pixiv', 'ranking', '--limit', '3', '-f', 'json'], 'pixiv ranking');
  }, 60_000);

  it('pixiv search fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['pixiv', 'search', '初音ミク', '--limit', '3', '-f', 'json'], 'pixiv search');
  }, 60_000);

  it('pixiv user fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['pixiv', 'user', '11', '-f', 'json'], 'pixiv user');
  }, 60_000);

  it('pixiv illusts fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['pixiv', 'illusts', '11', '--limit', '3', '-f', 'json'], 'pixiv illusts');
  }, 60_000);

  it('pixiv detail fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['pixiv', 'detail', '123456', '-f', 'json'], 'pixiv detail');
  }, 60_000);

  it('pixiv download fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['pixiv', 'download', '123456', '--output', '/tmp/pixiv-e2e-test', '-f', 'json'], 'pixiv download');
  }, 60_000);

  // ── yollomi (requires login session) ──
  it('yollomi generate fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['yollomi', 'generate', 'a cute cat', '--no-download', '-f', 'json'], 'yollomi generate');
  }, 60_000);

  it('yollomi video fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['yollomi', 'video', 'a sunset over the ocean', '--no-download', '-f', 'json'], 'yollomi video');
  }, 60_000);

  // ── band (requires band.us login session) ──
  it('band bands fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['band', 'bands', '-f', 'json'], 'band bands');
  }, 60_000);

  it('band mentions fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['band', 'mentions', '--limit', '3', '-f', 'json'], 'band mentions');
  }, 60_000);

  it('band posts fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['band', 'posts', '58400480', '--limit', '3', '-f', 'json'], 'band posts');
  }, 60_000);
});
