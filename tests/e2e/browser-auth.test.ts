/**
 * E2E tests for login-required browser commands.
 * These commands REQUIRE authentication (cookie/session).
 * In CI (headless, no login), they should fail gracefully — NOT crash.
 *
 * These tests verify the error handling path, not the data extraction.
 */

import { describe, it } from 'vitest';
import { expectGracefulAuthFailure } from './browser-auth-helpers.js';

describe('login-required commands — graceful failure', () => {

  // ── bilibili (requires cookie session) ──
  it('bilibili me fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['bilibili', 'me', '-f', 'json']);
  }, 60_000);

  it('bilibili dynamic fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['bilibili', 'dynamic', '--limit', '3', '-f', 'json']);
  }, 60_000);

  it('bilibili favorite fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['bilibili', 'favorite', '--limit', '3', '-f', 'json']);
  }, 60_000);

  it('bilibili history fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['bilibili', 'history', '--limit', '3', '-f', 'json']);
  }, 60_000);

  it('bilibili following fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['bilibili', 'following', '--limit', '3', '-f', 'json']);
  }, 60_000);

  // ── twitter (requires login) ──
  it('twitter bookmarks fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['twitter', 'bookmarks', '--limit', '3', '-f', 'json']);
  }, 60_000);

  it('twitter timeline fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['twitter', 'timeline', '--limit', '3', '-f', 'json']);
  }, 60_000);

  it('twitter notifications fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['twitter', 'notifications', '--limit', '3', '-f', 'json']);
  }, 60_000);

  // ── v2ex (requires login) ──
  it('v2ex me fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['v2ex', 'me', '-f', 'json']);
  }, 60_000);

  it('v2ex notifications fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['v2ex', 'notifications', '--limit', '3', '-f', 'json']);
  }, 60_000);

  // ── xueqiu (requires login) ──
  it('xueqiu feed fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['xueqiu', 'feed', '--limit', '3', '-f', 'json']);
  }, 60_000);

  it('xueqiu watchlist fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['xueqiu', 'watchlist', '-f', 'json']);
  }, 60_000);

  it('xueqiu comments fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['xueqiu', 'comments', 'SH600519', '--limit', '3', '-f', 'json'], 'xueqiu comments');
  }, 60_000);

  // ── linux-do (requires login — all endpoints need authentication) ──
  it('linux-do feed fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['linux-do', 'feed', '--limit', '3', '-f', 'json']);
  }, 60_000);

  it('linux-do categories fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['linux-do', 'categories', '--limit', '3', '-f', 'json']);
  }, 60_000);

  it('linux-do tags fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['linux-do', 'tags', '--limit', '3', '-f', 'json']);
  }, 60_000);

  it('linux-do topic fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['linux-do', 'topic', '1', '-f', 'json']);
  }, 60_000);

  it('linux-do topic-content fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['linux-do', 'topic-content', '1', '-f', 'json']);
  }, 60_000);

  it('linux-do search fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['linux-do', 'search', 'test', '--limit', '3', '-f', 'json']);
  }, 60_000);

  it('linux-do user-topics fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['linux-do', 'user-topics', 'test', '--limit', '3', '-f', 'json']);
  }, 60_000);

  it('linux-do user-posts fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['linux-do', 'user-posts', 'test', '--limit', '3', '-f', 'json']);
  }, 60_000);

  // ── xiaohongshu (requires login) ──
  it('xiaohongshu feed fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['xiaohongshu', 'feed', '--limit', '3', '-f', 'json']);
  }, 60_000);

  it('xiaohongshu notifications fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['xiaohongshu', 'notifications', '--limit', '3', '-f', 'json']);
  }, 60_000);

  // ── yuanbao (requires login) ──
  it('yuanbao new fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['yuanbao', 'new', '-f', 'json']);
  }, 60_000);

  it('yuanbao ask fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['yuanbao', 'ask', '你好', '-f', 'json']);
  }, 60_000);

  // ── pixiv (requires login) ──
  it('pixiv ranking fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['pixiv', 'ranking', '--limit', '3', '-f', 'json']);
  }, 60_000);

  it('pixiv search fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['pixiv', 'search', '初音ミク', '--limit', '3', '-f', 'json']);
  }, 60_000);

  it('pixiv user fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['pixiv', 'user', '11', '-f', 'json']);
  }, 60_000);

  it('pixiv illusts fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['pixiv', 'illusts', '11', '--limit', '3', '-f', 'json']);
  }, 60_000);

  it('pixiv detail fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['pixiv', 'detail', '123456', '-f', 'json']);
  }, 60_000);

  it('pixiv download fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['pixiv', 'download', '123456', '--output', '/tmp/pixiv-e2e-test', '-f', 'json']);
  }, 60_000);

  // ── yollomi (requires login session) ──
  it('yollomi generate fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['yollomi', 'generate', 'a cute cat', '--no-download', '-f', 'json']);
  }, 60_000);

  it('yollomi video fails gracefully without login', async () => {
    await expectGracefulAuthFailure(['yollomi', 'video', 'a sunset over the ocean', '--no-download', '-f', 'json']);
  }, 60_000);
});
