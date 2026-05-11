/**
 * Rednote home feed — reads the hydrated Pinia `feed.feeds` array directly.
 *
 * Differs from xiaohongshu/feed because rednote.com surfaces feed items in
 * camelCase on the client side (`noteCard.displayTitle`, `interactInfo.likedCount`)
 * while the xhs feed pipeline uses the snake_case shape returned by the
 * `/homefeed` API on xiaohongshu.com. The store is already hydrated on first
 * `/explore` load so a func-mode read avoids needing a network tap.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

function parseLimit(raw) {
    const parsed = Number(raw ?? 20);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        throw new ArgumentError(`--limit must be a positive integer, got ${JSON.stringify(raw)}`);
    }
    if (parsed < 1) {
        throw new ArgumentError(`--limit must be a positive integer, got ${parsed}`);
    }
    return parsed;
}

const FEEDS_READ_JS = `
  (() => {
    let pinia = null;
    const probe = (el) => el?.__vue_app__?.config?.globalProperties?.$pinia ?? null;
    pinia = probe(document.querySelector('#app'));
    if (!pinia) {
      // Some rednote builds mount under a different root id; fall back to a
      // full scan only when the standard mount node misses.
      for (const el of document.querySelectorAll('*')) {
        pinia = probe(el);
        if (pinia) break;
      }
    }
    if (!pinia || !pinia._s) return { error: 'no_pinia' };
    const store = pinia._s.get('feed');
    if (!store) return { error: 'no_feed_store' };
    const feeds = store.feeds;
    if (!Array.isArray(feeds)) return { error: 'feeds_not_array' };
    return {
      items: feeds.map(entry => {
        const card = entry?.noteCard ?? {};
        return {
          id: entry?.id ?? '',
          title: card.displayTitle ?? '',
          type: card.type ?? '',
          author: card.user?.nickName ?? card.user?.nickname ?? '',
          likes: card.interactInfo?.likedCount ?? '',
        };
      }),
    };
  })()
`;

export const command = cli({
    site: 'rednote',
    name: 'feed',
    access: 'read',
    description: 'Rednote home feed (reads hydrated Pinia store)',
    domain: 'www.rednote.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of items to return' },
    ],
    columns: ['id', 'title', 'author', 'likes', 'type', 'url'],
    func: async (page, kwargs) => {
        const limit = parseLimit(kwargs.limit);
        await page.goto('https://www.rednote.com/explore');
        // Pinia store hydrates synchronously from SSR; give the page a beat to
        // finish bootstrapping before reading the array.
        await page.wait({ time: 2 });
        const data = await page.evaluate(FEEDS_READ_JS);
        if (!data || typeof data !== 'object') {
            throw new CommandExecutionError('rednote feed: unexpected evaluate response');
        }
        if (data.error) {
            throw new CommandExecutionError(`rednote feed: ${data.error}`, 'The rednote SPA may still be hydrating; reload www.rednote.com/explore and retry.');
        }
        const rows = (data.items || [])
            .filter((row) => row.id)
            .slice(0, limit)
            .map((row) => ({
            ...row,
            url: `https://www.rednote.com/explore/${row.id}`,
        }));
        if (rows.length === 0) {
            throw new EmptyResultError('rednote/feed', 'No feed items in the hydrated store.');
        }
        return rows;
    },
});
