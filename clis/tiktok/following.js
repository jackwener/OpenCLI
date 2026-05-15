// List the accounts the logged-in user follows via page-context API.
//
// Replaces legacy DOM-link scraping which mistakenly hoovered up navigation
// links and "Profile" / "Upload" labels. We resolve the viewer's `secUid` from
// the warm `__UNIVERSAL_DATA_FOR_REHYDRATION__` snapshot, then page through
// `/api/user/list/?scene=21` (TikTok's own following endpoint).

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
const MAX_LIMIT = 200;

function buildFollowingScript(limit) {
    return `
(async () => {
  const limit = ${Number(limit)};
  const maxPages = ${MAX_PAGES * 2};
  const SERVER_PAGE_MAX = ${SERVER_PAGE_MAX};
  const pageSize = limit < SERVER_PAGE_MAX ? limit : SERVER_PAGE_MAX;
  const aid = ${JSON.stringify(TIKTOK_AID)};

  ${BROWSER_HELPERS}
  ${USER_ITEM_NORMALIZER}

  function findViewerSecUid(root) {
    if (!root) return '';
    let found = '';
    walkObjects(root, (node) => {
      if (Array.isArray(node)) return false;
      const candidate = node?.user;
      if (candidate && typeof candidate === 'object') {
        const secUid = String(candidate.secUid || candidate.sec_uid || '').trim();
        const isMe = Boolean(candidate.isOwner || candidate.is_owner || candidate.isCurrentUser);
        if (secUid && isMe) {
          found = secUid;
          return true;
        }
      }
      const direct = node?.userInfo?.user;
      if (direct && (direct.isOwner || direct.is_owner)) {
        const secUid = String(direct.secUid || direct.sec_uid || '').trim();
        if (secUid) {
          found = secUid;
          return true;
        }
      }
      return false;
    });
    return found;
  }

  const universal = findUniversalData();
  let viewerSecUid = findViewerSecUid(universal);
  const msToken = getCookie('msToken');

  if (!viewerSecUid) {
    try {
      const me = await fetchJson('/api/user/info/?aid=' + aid + (msToken ? '&msToken=' + encodeURIComponent(msToken) : ''));
      viewerSecUid = String(me?.userInfo?.user?.secUid || me?.user?.secUid || me?.userInfo?.secUid || '').trim();
    } catch {
      // Fall through to typed AUTH_REQUIRED below.
    }
  }
  if (!viewerSecUid) {
    throw new Error('AUTH_REQUIRED: cannot resolve viewer secUid (login required)');
  }

  const dedup = new Map();
  let apiFailure = null;
  let cursor = 0;
  for (let page = 0; page < maxPages && dedup.size < limit; page += 1) {
    const params = new URLSearchParams({
      aid,
      scene: '21',
      secUid: viewerSecUid,
      count: String(pageSize),
      minCursor: String(cursor),
      maxCursor: '0',
    });
    if (msToken) params.set('msToken', msToken);
    try {
      const data = await fetchJson('/api/user/list/?' + params.toString());
      assertTikTokApiSuccess(data, 'user-list');
      const list = Array.isArray(data.userList)
        ? data.userList
        : (Array.isArray(data.user_list) ? data.user_list : []);
      if (list.length === 0) break;
      for (const entry of list) {
        const row = normalizeUserRow(entry?.user || entry, dedup.size + 1);
        if (row && !dedup.has(row.username)) dedup.set(row.username, row);
      }
      if (data.hasMore !== true) break;
      cursor = asNumber(data.minCursor) ?? asNumber(data.cursor) ?? cursor + list.length;
    } catch (error) {
      apiFailure = error instanceof Error ? error.message : String(error);
      break;
    }
  }

  const rows = Array.from(dedup.values())
    .slice(0, limit)
    .map((row, index) => ({ ...row, index: index + 1 }));

  if (rows.length === 0) {
    const suffix = apiFailure ? ' (user-list API failed: ' + apiFailure + ')' : '';
    throw new Error('No following entries returned' + suffix);
  }
  return rows;
})()
`;
}

async function listFollowing(page, args) {
    const limit = requireLimit(args.limit, { fallback: DEFAULT_LIMIT, max: MAX_LIMIT });
    await page.goto('https://www.tiktok.com/following', { waitUntil: 'load', settleMs: 5000 });
    let rows;
    try {
        rows = await page.evaluate(buildFollowingScript(limit));
    } catch (error) {
        throwTikTokPageContextError(error, {
            authMessage: 'TikTok requires login to read your following list',
            emptyPattern: /No following entries/,
            emptyTarget: 'tiktok following',
            failureMessage: 'Failed to load TikTok following list',
        });
    }
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new EmptyResultError('tiktok following', 'TikTok returned no following entries');
    }
    return rows;
}

export const followingCommand = cli({
    site: 'tiktok',
    name: 'following',
    access: 'read',
    description: 'List accounts the logged-in user follows on TikTok via page-context APIs',
    domain: 'www.tiktok.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: `Number of accounts (max ${MAX_LIMIT})` },
    ],
    columns: ['index', 'username', 'name', 'secUid', 'verified', 'followers', 'following', 'url'],
    func: listFollowing,
});

export const __test__ = {
    buildFollowingScript,
    DEFAULT_LIMIT,
    MAX_LIMIT,
};
