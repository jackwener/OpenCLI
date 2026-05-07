// Browse TikTok live streams via page-context API.
//
// Replaces legacy DOM card scraping (`[data-e2e="live-side-nav-item"]` plus a
// regex pulling viewer counts from card text). We extract from the live-discover
// state injected on `/live`, then top up via `/api/live/discover/get/`.

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    EmptyResultError,
} from '@jackwener/opencli/errors';
import {
    BROWSER_HELPERS,
    LIVE_ITEM_NORMALIZER,
    SERVER_PAGE_MAX,
    TIKTOK_AID,
    requireLimit,
    throwTikTokPageContextError,
} from './utils.js';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 60;

function buildLiveScript(limit) {
    return `
(async () => {
  const limit = ${Number(limit)};
  const SERVER_PAGE_MAX = ${SERVER_PAGE_MAX};
  const pageSize = limit < SERVER_PAGE_MAX ? limit : SERVER_PAGE_MAX;
  const aid = ${JSON.stringify(TIKTOK_AID)};

  ${BROWSER_HELPERS}
  ${LIVE_ITEM_NORMALIZER}

  function collectFromState(root) {
    if (!root) return [];
    const out = [];
    walkObjects(root, (node) => {
      if (Array.isArray(node)) return false;
      if (Array.isArray(node.liveList)) {
        for (const entry of node.liveList) out.push(entry);
      }
      if (Array.isArray(node.live_list)) {
        for (const entry of node.live_list) out.push(entry);
      }
      if (Array.isArray(node.discoverList)) {
        for (const entry of node.discoverList) out.push(entry);
      }
      return false;
    });
    return out;
  }

  const dedup = new Map();
  const universal = findUniversalData();
  for (const item of collectFromState(universal)) {
    const row = normalizeLiveItem(item, dedup.size + 1);
    if (row) {
      const key = row.streamer || row.url;
      if (key && !dedup.has(key)) dedup.set(key, row);
    }
  }

  let apiFailure = null;
  const msToken = getCookie('msToken');
  if (dedup.size < limit) {
    const params = new URLSearchParams({
      aid,
      count: String(pageSize),
      from_page: 'live_discover',
    });
    if (msToken) params.set('msToken', msToken);
    try {
      const data = await fetchJson('/api/live/discover/get/?' + params.toString());
      assertTikTokApiSuccess(data, 'live-discover');
      const list = Array.isArray(data.data?.list)
        ? data.data.list
        : (Array.isArray(data.list)
          ? data.list
          : (Array.isArray(data.live_list) ? data.live_list : []));
      for (const entry of list) {
        const row = normalizeLiveItem(entry, dedup.size + 1);
        if (row) {
          const key = row.streamer || row.url;
          if (key && !dedup.has(key)) dedup.set(key, row);
        }
      }
    } catch (error) {
      apiFailure = error instanceof Error ? error.message : String(error);
    }
  }

  const rows = Array.from(dedup.values())
    .slice(0, limit)
    .map((row, index) => ({ ...row, index: index + 1 }));

  if (rows.length === 0) {
    const suffix = apiFailure ? ' (live-discover API failed: ' + apiFailure + ')' : '';
    throw new Error('No live streams returned' + suffix);
  }
  return rows;
})()
`;
}

async function listLive(page, args) {
    const limit = requireLimit(args.limit, { fallback: DEFAULT_LIMIT, max: MAX_LIMIT });
    await page.goto('https://www.tiktok.com/live', { waitUntil: 'load', settleMs: 5000 });
    let rows;
    try {
        rows = await page.evaluate(buildLiveScript(limit));
    } catch (error) {
        throwTikTokPageContextError(error, {
            authMessage: 'TikTok requires browser access to load live streams',
            emptyPattern: /No live streams returned/,
            emptyTarget: 'tiktok live',
            failureMessage: 'Failed to load TikTok live streams',
        });
    }
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new EmptyResultError('tiktok live', 'TikTok returned no live streams');
    }
    return rows;
}

export const liveCommand = cli({
    site: 'tiktok',
    name: 'live',
    access: 'read',
    description: 'Browse TikTok live streams via page-context APIs',
    domain: 'www.tiktok.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: `Number of streams (max ${MAX_LIMIT})` },
    ],
    columns: ['index', 'streamer', 'name', 'title', 'viewers', 'likes', 'secUid', 'url'],
    func: listLive,
});

export const __test__ = {
    buildLiveScript,
    DEFAULT_LIMIT,
    MAX_LIMIT,
};
