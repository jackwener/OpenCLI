// TikTok friend / who-to-follow suggestions via page-context API.
//
// Replaces legacy DOM-link scraping (`querySelectorAll('a[href*="/@"]')` plus
// fragile text filters that mistook UI labels for handles). We pull the
// suggestion list from `__UNIVERSAL_DATA_FOR_REHYDRATION__` first, then
// top up via `/api/recommend/user/` if the warm snapshot is short.

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    EmptyResultError,
} from '@jackwener/opencli/errors';
import {
    BROWSER_HELPERS,
    MAX_PAGES,
    SERVER_PAGE_MAX,
    TIKTOK_AID,
    USER_ITEM_NORMALIZER,
    requireLimit,
    throwTikTokPageContextError,
} from './utils.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function buildFriendsScript(limit) {
    return `
(async () => {
  const limit = ${Number(limit)};
  const maxPages = ${MAX_PAGES};
  const SERVER_PAGE_MAX = ${SERVER_PAGE_MAX};
  const pageSize = limit < SERVER_PAGE_MAX ? limit : SERVER_PAGE_MAX;
  const aid = ${JSON.stringify(TIKTOK_AID)};

  ${BROWSER_HELPERS}
  ${USER_ITEM_NORMALIZER}

  function collectUsersFromState(root) {
    if (!root) return [];
    const out = [];
    walkObjects(root, (node) => {
      if (Array.isArray(node)) return false;
      if (Array.isArray(node.userList)) {
        for (const entry of node.userList) {
          out.push(entry?.user || entry);
        }
      }
      if (Array.isArray(node.suggestList)) {
        for (const entry of node.suggestList) out.push(entry?.user || entry);
      }
      return false;
    });
    return out;
  }

  const dedup = new Map();
  const universal = findUniversalData();
  for (const user of collectUsersFromState(universal)) {
    const row = normalizeUserRow(user, dedup.size + 1);
    if (row && !dedup.has(row.username)) dedup.set(row.username, row);
  }

  let apiFailure = null;
  const msToken = getCookie('msToken');
  if (dedup.size < limit) {
    let cursor = 0;
    for (let page = 0; page < maxPages && dedup.size < limit; page += 1) {
      const params = new URLSearchParams({
        aid,
        count: String(pageSize),
        cursor: String(cursor),
        scene: '15',
      });
      if (msToken) params.set('msToken', msToken);
      try {
        const data = await fetchJson('/api/recommend/user/?' + params.toString());
        assertTikTokApiSuccess(data, 'recommend-user');
        const list = Array.isArray(data.userList)
          ? data.userList
          : (Array.isArray(data.user_list) ? data.user_list : []);
        if (list.length === 0) break;
        for (const entry of list) {
          const row = normalizeUserRow(entry?.user || entry, dedup.size + 1);
          if (row && !dedup.has(row.username)) dedup.set(row.username, row);
        }
        if (data.hasMore !== true) break;
        cursor = asNumber(data.cursor) ?? cursor + list.length;
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
    const suffix = apiFailure ? ' (recommend-user API failed: ' + apiFailure + ')' : '';
    throw new Error('No friend suggestions returned by TikTok' + suffix);
  }
  return rows;
})()
`;
}

async function listFriends(page, args) {
    const limit = requireLimit(args.limit, { fallback: DEFAULT_LIMIT, max: MAX_LIMIT });
    await page.goto('https://www.tiktok.com/friends', { waitUntil: 'load', settleMs: 5000 });
    let rows;
    try {
        rows = await page.evaluate(buildFriendsScript(limit));
    } catch (error) {
        throwTikTokPageContextError(error, {
            authMessage: 'TikTok requires browser access to load friend suggestions',
            emptyPattern: /No friend suggestions/,
            emptyTarget: 'tiktok friends',
            failureMessage: 'Failed to load TikTok friend suggestions',
        });
    }
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new EmptyResultError('tiktok friends', 'TikTok returned no friend suggestions');
    }
    return rows;
}

export const friendsCommand = cli({
    site: 'tiktok',
    name: 'friends',
    access: 'read',
    description: 'Get TikTok friend / who-to-follow suggestions via page-context APIs',
    domain: 'www.tiktok.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: `Number of suggestions (max ${MAX_LIMIT})` },
    ],
    columns: ['index', 'username', 'name', 'secUid', 'verified', 'followers', 'following', 'url'],
    func: listFriends,
});

export const __test__ = {
    buildFriendsScript,
    DEFAULT_LIMIT,
    MAX_LIMIT,
};
