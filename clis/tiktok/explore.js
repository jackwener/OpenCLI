// Browse TikTok "For You" / explore feed via page-context API.
//
// Replaces legacy DOM-link scraping (`querySelectorAll('a[href*="/video/"]')`).
// We borrow the live page session: read `__UNIVERSAL_DATA_FOR_REHYDRATION__` for
// the warm `webapp.recommend-feed` snapshot, then extend with `/api/recommend/item_list/`
// when a larger `--limit` is requested. Stays inside the browser, so the session
// cookies + msToken go along automatically.

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    EmptyResultError,
} from '@jackwener/opencli/errors';
import {
    BROWSER_HELPERS,
    MAX_PAGES,
    SERVER_PAGE_MAX,
    TIKTOK_AID,
    requireLimit,
    throwTikTokPageContextError,
    VIDEO_ITEM_NORMALIZER,
} from './utils.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 120;

function buildExploreScript(limit) {
    return `
(async () => {
  const limit = ${Number(limit)};
  const maxPages = ${MAX_PAGES};
  const SERVER_PAGE_MAX = ${SERVER_PAGE_MAX};
  // limit was validated upfront (requireLimit). pageSize is the per-request
  // cap TikTok accepts; we still loop until \`dedup.size < limit\` is satisfied.
  const pageSize = limit < SERVER_PAGE_MAX ? limit : SERVER_PAGE_MAX;
  const aid = ${JSON.stringify(TIKTOK_AID)};

  ${BROWSER_HELPERS}
  ${VIDEO_ITEM_NORMALIZER}

  function collectFromState(root) {
    if (!root) return [];
    const out = [];
    walkObjects(root, (node) => {
      if (Array.isArray(node)) return false;
      if (Array.isArray(node.itemList)) {
        for (const item of node.itemList) out.push(item);
      }
      if (Array.isArray(node.items)) {
        for (const item of node.items) out.push(item);
      }
      return false;
    });
    return out;
  }

  const dedup = new Map();
  const universal = findUniversalData();
  for (const item of collectFromState(universal)) {
    const row = normalizeVideoItem(item, dedup.size + 1);
    if (row && !dedup.has(row.id)) dedup.set(row.id, row);
  }

  const msToken = getCookie('msToken');
  let apiFailure = null;
  if (dedup.size < limit) {
    let cursor = 0;
    for (let page = 0; page < maxPages && dedup.size < limit; page += 1) {
      const params = new URLSearchParams({
        aid,
        count: String(pageSize),
        from_page: 'fyp',
        cursor: String(cursor),
      });
      if (msToken) params.set('msToken', msToken);
      try {
        const data = await fetchJson('/api/recommend/item_list/?' + params.toString());
        assertTikTokApiSuccess(data, 'recommend');
        const items = Array.isArray(data.itemList) ? data.itemList : [];
        for (const item of items) {
          const row = normalizeVideoItem(item, dedup.size + 1);
          if (row && !dedup.has(row.id)) dedup.set(row.id, row);
        }
        if (data.hasMore !== true && items.length === 0) break;
        cursor = asNumber(data.cursor) ?? cursor + items.length;
      } catch (error) {
        apiFailure = error instanceof Error ? error.message : String(error);
        break;
      }
    }
  }

  const rows = Array.from(dedup.values())
    .slice(0, limit)
    .map((row, index) => ({ ...row, index: index + 1 }));

  if (rows.length === 0) {
    const suffix = apiFailure ? ' (recommend API failed: ' + apiFailure + ')' : '';
    throw new Error('No videos found on /explore' + suffix);
  }
  return rows;
})()
`;
}

async function listExploreVideos(page, args) {
    const limit = requireLimit(args.limit, { fallback: DEFAULT_LIMIT, max: MAX_LIMIT });
    await page.goto('https://www.tiktok.com/explore', { waitUntil: 'load', settleMs: 5000 });
    let rows;
    try {
        rows = await page.evaluate(buildExploreScript(limit));
    } catch (error) {
        throwTikTokPageContextError(error, {
            authMessage: 'TikTok requires browser access to load the explore feed',
            emptyPattern: /No videos found/,
            emptyTarget: 'tiktok explore',
            failureMessage: 'Failed to load TikTok explore feed',
        });
    }
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new EmptyResultError('tiktok explore', 'TikTok returned an empty recommend feed');
    }
    return rows;
}

export const exploreCommand = cli({
    site: 'tiktok',
    name: 'explore',
    access: 'read',
    description: 'Get trending TikTok videos from the recommend feed via page-context APIs',
    domain: 'www.tiktok.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: `Number of videos to return (max ${MAX_LIMIT})` },
    ],
    columns: ['index', 'id', 'author', 'url', 'cover', 'title', 'desc', 'plays', 'likes', 'comments', 'shares', 'createTime'],
    func: listExploreVideos,
});

export const __test__ = {
    buildExploreScript,
    DEFAULT_LIMIT,
    MAX_LIMIT,
};
