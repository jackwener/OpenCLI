/**
 * Weibo persistent site-session conventions.
 *
 * Every weibo command must reuse the stable `site:weibo` tab
 * (siteSession: 'persistent') and own its navigation
 * (navigateBefore: false) so a warm tab is never re-navigated to the
 * homepage on every invocation. The ajax-based commands must go through
 * the ensureWeiboPage URL guard: navigate only when the tab is not
 * already on a weibo.com origin page (relative /ajax fetches break on
 * s.weibo.com).
 */
import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ensureWeiboPage } from './utils.js';
import './search.js';
import './post.js';
import './comments.js';
import './hot.js';
import './feed.js';
import './me.js';
import './user.js';
import './user-posts.js';
import './favorites.js';
import './delete.js';
import './publish.js';

const ALL_COMMANDS = [
  'search',
  'post',
  'comments',
  'hot',
  'feed',
  'me',
  'user',
  'user-posts',
  'favorites',
  'delete',
  'publish',
];

// Commands whose func needs nothing but a weibo.com origin (relative
// /ajax fetch or getSelfUid). favorites is included: its homepage goto
// only exists to feed getSelfUid before the fav-page goto.
// feed/me/favorites resolve the logged-in uid first; feed them one valid
// uid so getSelfUid succeeds without triggering its stale-tab reload.
const GUARDED_COMMANDS = [
  { name: 'post', kwargs: { id: '1' } },
  { name: 'comments', kwargs: { id: '1' } },
  { name: 'hot', kwargs: {} },
  { name: 'feed', kwargs: {}, evalResults: ['1931632001'] },
  { name: 'me', kwargs: {}, evalResults: ['1931632001'] },
  { name: 'user', kwargs: { id: '1' } },
  { name: 'user-posts', kwargs: { id: '1' } },
  { name: 'favorites', kwargs: {}, evalResults: ['1931632001'] },
  { name: 'delete', kwargs: { id: '5188964593845467' } },
];

function makePage(currentUrl, evalResults = []) {
  const queue = [...evalResults];
  return {
    getCurrentUrl: vi.fn().mockResolvedValue(currentUrl),
    goto: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn(async () => (queue.length ? queue.shift() : null)),
    click: vi.fn().mockResolvedValue(undefined),
  };
}

describe('weibo siteSession conventions', () => {
  it.each(ALL_COMMANDS)('weibo/%s declares persistent session and owns navigation', (name) => {
    const command = getRegistry().get(`weibo/${name}`);
    expect(command, `weibo/${name} not registered`).toBeTruthy();
    expect(command.siteSession).toBe('persistent');
    expect(command.navigateBefore).toBe(false);
  });
});

describe('ensureWeiboPage', () => {
  it('does not navigate when already on weibo.com', async () => {
    const page = makePage('https://weibo.com/hot/weibo');
    await ensureWeiboPage(page);
    expect(page.goto).not.toHaveBeenCalled();
    expect(page.wait).not.toHaveBeenCalled();
  });

  it('does not navigate when already on www.weibo.com', async () => {
    const page = makePage('https://www.weibo.com/u/12345');
    await ensureWeiboPage(page);
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('navigates away from s.weibo.com (relative /ajax would hit the wrong origin)', async () => {
    const page = makePage('https://s.weibo.com/weibo?q=x');
    await ensureWeiboPage(page);
    expect(page.goto).toHaveBeenCalledWith('https://weibo.com');
    expect(page.wait).toHaveBeenCalledWith(2);
  });

  it('navigates from about:blank', async () => {
    const page = makePage('about:blank');
    await ensureWeiboPage(page);
    expect(page.goto).toHaveBeenCalledWith('https://weibo.com');
  });

  it('navigates when getCurrentUrl is unavailable', async () => {
    const page = makePage(null);
    delete page.getCurrentUrl;
    await ensureWeiboPage(page);
    expect(page.goto).toHaveBeenCalledWith('https://weibo.com');
  });

  it('navigates when getCurrentUrl rejects', async () => {
    const page = makePage(null);
    page.getCurrentUrl = vi.fn().mockRejectedValue(new Error('detached'));
    await ensureWeiboPage(page);
    expect(page.goto).toHaveBeenCalledWith('https://weibo.com');
  });
});

describe('warm-tab navigation guard in command funcs', () => {
  it.each(GUARDED_COMMANDS)(
    'weibo/$name skips the homepage goto when the tab is already on weibo.com',
    async ({ name, kwargs, evalResults }) => {
      const command = getRegistry().get(`weibo/${name}`);
      const page = makePage('https://weibo.com/', evalResults);
      await command.func(page, kwargs).catch(() => {});
      expect(page.goto).not.toHaveBeenCalledWith('https://weibo.com');
    },
  );

  it.each(GUARDED_COMMANDS)(
    'weibo/$name still navigates when the tab is elsewhere',
    async ({ name, kwargs }) => {
      const command = getRegistry().get(`weibo/${name}`);
      const page = makePage('about:blank');
      await command.func(page, kwargs).catch(() => {});
      expect(page.goto).toHaveBeenCalledWith('https://weibo.com');
    },
  );
});
