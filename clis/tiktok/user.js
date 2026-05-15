// Get recent videos from a TikTok user's public profile via page-context APIs.
//
// This is the `tiktok user` counterpart to the Phase-3 read refactor: resolve
// the profile `secUid`, page `/api/post/item_list/`, and use exact-author search
// only as a lower-authority fallback. All requests run inside the live page so
// cookies + msToken are forwarded by the browser.

import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    BROWSER_HELPERS,
    MAX_PAGES,
    SERVER_PAGE_MAX,
    TIKTOK_AID,
    VIDEO_ITEM_NORMALIZER,
    normalizeUsername,
    requireLimit,
    throwTikTokPageContextError,
} from './utils.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 120;

function buildUserScript(username, limit) {
    return `
(async () => {
  const username = ${JSON.stringify(username)};
  const usernameLower = username.toLowerCase();
  const limit = ${Number(limit)};
  const maxPages = ${MAX_PAGES};
  const SERVER_PAGE_MAX = ${SERVER_PAGE_MAX};
  const pageSize = limit < SERVER_PAGE_MAX ? limit : SERVER_PAGE_MAX;
  const aid = ${JSON.stringify(TIKTOK_AID)};

  ${BROWSER_HELPERS}
  ${VIDEO_ITEM_NORMALIZER}

  function findProfileUser(root) {
    if (!root) return null;
    let found = null;
    walkObjects(root, (node) => {
      if (Array.isArray(node)) return false;
      const user = node?.userInfo?.user || node?.user;
      if (!user || typeof user !== 'object') return false;
      const uniqueId = String(user.uniqueId || user.unique_id || '').toLowerCase();
      if (uniqueId === usernameLower && (user.secUid || user.sec_uid)) {
        found = user;
        return true;
      }
      return false;
    });
    return found;
  }

  function collectProfileItems(root, secUid) {
    if (!root) return [];
    const out = [];
    walkObjects(root, (node) => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
      const item = node.itemStruct || node.item || node;
      const id = item?.id || item?.item_id || item?.video_id;
      const author = item?.author || item?.authorInfo || {};
      const authorName = String(author.uniqueId || author.unique_id || item?.author_unique_id || '').toLowerCase();
      const authorSecUid = String(author.secUid || author.sec_uid || '').trim();
      if (id && (authorName === usernameLower || (secUid && authorSecUid === secUid))) {
        out.push(item);
      }
      return false;
    });
    return out;
  }

  function addVideo(dedup, item, source) {
    const row = normalizeVideoItem(item, dedup.size + 1);
    if (!row || dedup.has(row.id)) return;
    dedup.set(row.id, { ...row, source });
  }

  const universal = findUniversalData();
  let secUid = '';
  const profileUser = findProfileUser(universal);
  if (profileUser) {
    secUid = String(profileUser.secUid || profileUser.sec_uid || '').trim();
  }

  const msToken = getCookie('msToken');
  if (!secUid) {
    const params = new URLSearchParams({ uniqueId: username, aid });
    if (msToken) params.set('msToken', msToken);
    const detail = await fetchJson('/api/user/detail/?' + params.toString());
    assertTikTokApiSuccess(detail, 'user-detail');
    secUid = String(detail?.userInfo?.user?.secUid || detail?.user?.secUid || '').trim();
  }
  if (!secUid) {
    throw new Error('No videos found for @' + username);
  }

  const dedup = new Map();
  for (const item of collectProfileItems(universal, secUid)) {
    addVideo(dedup, item, 'bootstrap');
  }

  let cursor = 0;
  let primaryFailure = null;
  for (let page = 0; page < maxPages && dedup.size < limit; page += 1) {
    const params = new URLSearchParams({
      secUid,
      count: String(pageSize),
      cursor: String(cursor),
      aid,
    });
    if (msToken) params.set('msToken', msToken);
    try {
      const data = await fetchJson('/api/post/item_list/?' + params.toString());
      assertTikTokApiSuccess(data, 'post-list');
      const items = Array.isArray(data.itemList) ? data.itemList : [];
      for (const item of items) addVideo(dedup, item, 'profile-api');
      if (data.hasMore !== true || items.length === 0) break;
      cursor = asNumber(data.cursor) ?? cursor + items.length;
    } catch (error) {
      primaryFailure = error instanceof Error ? error.message : String(error);
      break;
    }
  }

  let searchFailure = null;
  for (let offset = 0; offset < limit * 4 && dedup.size < limit; offset += pageSize) {
    const params = new URLSearchParams({
      keyword: username,
      offset: String(offset),
      count: String(pageSize),
      aid,
    });
    if (msToken) params.set('msToken', msToken);
    try {
      const data = await fetchJson('/api/search/general/full/?' + params.toString());
      assertTikTokApiSuccess(data, 'search');
      const entries = Array.isArray(data.data) ? data.data : [];
      if (entries.length === 0) break;
      for (const entry of entries) {
        if (entry?.type !== undefined && entry.type !== 1) continue;
        const item = entry?.item || entry?.itemStruct || entry;
        const author = item?.author || item?.authorInfo || {};
        const authorName = String(author.uniqueId || author.unique_id || '').toLowerCase();
        if (authorName !== usernameLower) continue;
        addVideo(dedup, item, 'search-fallback');
      }
    } catch (error) {
      searchFailure = error instanceof Error ? error.message : String(error);
      break;
    }
  }

  const rows = Array.from(dedup.values())
    .sort((a, b) => (Number(b.createTime) || 0) - (Number(a.createTime) || 0))
    .slice(0, limit)
    .map((row, index) => ({ ...row, index: index + 1 }));

  if (rows.length === 0) {
    const suffix = primaryFailure || searchFailure
      ? ' (profile/search API failed: ' + (primaryFailure || searchFailure) + ')'
      : '';
    throw new Error('No videos found for @' + username + suffix);
  }
  return rows;
})()
`;
}

async function listUserVideos(page, args) {
    const username = normalizeUsername(args.username);
    const limit = requireLimit(args.limit, { fallback: DEFAULT_LIMIT, max: MAX_LIMIT });
    await page.goto(`https://www.tiktok.com/@${encodeURIComponent(username)}`, { waitUntil: 'load', settleMs: 6000 });
    let rows;
    try {
        rows = await page.evaluate(buildUserScript(username, limit));
    } catch (error) {
        throwTikTokPageContextError(error, {
            authMessage: 'TikTok requires browser access to load user videos',
            emptyPattern: /No videos found/,
            emptyTarget: 'tiktok user',
            failureMessage: 'Failed to fetch TikTok user videos',
        });
    }
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new EmptyResultError('tiktok user', `No videos found for @${username}`);
    }
    return rows;
}

export const userCommand = cli({
    site: 'tiktok',
    name: 'user',
    access: 'read',
    description: 'Get recent videos from a TikTok user via page-context APIs',
    domain: 'www.tiktok.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        {
            name: 'username',
            required: true,
            positional: true,
            help: 'TikTok username (without @)',
        },
        { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: `Number of videos to return (max ${MAX_LIMIT})` },
    ],
    columns: ['index', 'id', 'source', 'author', 'url', 'cover', 'title', 'desc', 'plays', 'likes', 'comments', 'shares', 'createTime'],
    func: listUserVideos,
});

export const __test__ = {
    buildUserScript,
    DEFAULT_LIMIT,
    MAX_LIMIT,
};
