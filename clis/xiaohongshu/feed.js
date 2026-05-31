/**
 * Xiaohongshu home feed — reads the hydrated Pinia `feed.feeds` array directly.
 *
 * Earlier versions used a `tap` step that called the `fetchFeeds` store action,
 * which fetches the NEXT page of recommendations. Those API items carry no
 * `xsecToken` and do not overlap the first-screen notes, so the feed's URLs
 * could not be passed to `note`/`comments`/`download` (which require a signed
 * URL). The hydrated store, by contrast, holds `entry.xsecToken` for every
 * first-screen note, so a func-mode read yields signed, drill-down-ready URLs.
 *
 * Mirrors rednote/feed.js: the hydrated store is camelCase on both sites
 * (`noteCard.displayTitle`, `interactInfo.likedCount`). This is the SSR store
 * shape, not the snake_case `/homefeed` API response the old tap intercepted.
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
      // Some builds mount under a different root id; fall back to a full scan
      // only when the standard mount node misses.
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
          // Live store exposes both user.nickname and user.nickName; prefer
          // nickname (observed populated on xhs), fall back to nickName.
          author: card.user?.nickname ?? card.user?.nickName ?? '',
          likes: card.interactInfo?.likedCount ?? '',
          // The note's signing token lives on the top-level entry. Do NOT read
          // card.user.xsecToken — that is the author profile's token, not the
          // note's.
          xsecToken: entry?.xsecToken ?? '',
        };
      }),
    };
  })()
`;

/**
 * Build a signed note URL for the given web host. Falls back to the bare
 * /explore/{id} URL when the entry is missing a token (an anomaly), so the
 * row still has a URL rather than dropping out.
 *
 * The `xsec_source` param mirrors what XHS itself renders into feed-page note
 * links: an empty value. Only `xsec_token` is actually required by the note
 * detail endpoint (verified: the source value is not validated), so we
 * reproduce the real-world shape rather than inventing a source label.
 */
export function buildFeedNoteUrl(webHost, id, xsecToken) {
    const base = `https://${webHost}/explore/${id}`;
    if (!xsecToken) return base;
    return `${base}?xsec_token=${xsecToken}&xsec_source=`;
}

/**
 * Shared func-mode implementation. Exported so the rednote adapter can run the
 * same store read against www.rednote.com without duplicating the logic.
 */
export async function runFeed(page, kwargs, webHost) {
    const limit = parseLimit(kwargs.limit);
    await page.goto(`https://${webHost}/explore`);
    // Pinia store hydrates from SSR; give the page a beat to finish
    // bootstrapping before reading the array.
    await page.wait({ time: 2 });
    const data = await page.evaluate(FEEDS_READ_JS);
    if (!data || typeof data !== 'object') {
        throw new CommandExecutionError(`${webHost} feed: unexpected evaluate response`);
    }
    if (data.error) {
        throw new CommandExecutionError(`${webHost} feed: ${data.error}`, `The SPA may still be hydrating; reload ${webHost}/explore and retry.`);
    }
    const rows = (data.items || [])
        .filter((row) => row.id)
        .slice(0, limit)
        .map((row) => ({
        id: row.id,
        title: row.title,
        type: row.type,
        author: row.author,
        likes: row.likes,
        url: buildFeedNoteUrl(webHost, row.id, row.xsecToken),
    }));
    if (rows.length === 0) {
        throw new EmptyResultError(`${webHost}/feed`, 'No feed items in the hydrated store.');
    }
    return rows;
}

export const command = cli({
    site: 'xiaohongshu',
    name: 'feed',
    access: 'read',
    description: '小红书首页推荐 Feed (reads hydrated Pinia store)',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of items to return' },
    ],
    columns: ['id', 'title', 'author', 'likes', 'type', 'url'],
    func: async (page, kwargs) => runFeed(page, kwargs, 'www.xiaohongshu.com'),
});
