// Read TikTok inbox notifications via page-context API.
//
// Replaces the legacy "click the bell icon then scrape `[data-e2e="inbox-list"]`
// text content" pipeline. Calls `/api/notice/multi/?notice_type=N` directly
// from inside the live page so cookies + msToken get forwarded by the browser.

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    EmptyResultError,
} from '@jackwener/opencli/errors';
import {
    BROWSER_HELPERS,
    MAX_PAGES,
    NOTIFICATION_NORMALIZER,
    NOTIFICATION_TYPES,
    SERVER_PAGE_MAX,
    TIKTOK_AID,
    requireLimit,
    requireNotificationType,
    throwTikTokPageContextError,
} from './utils.js';

const DEFAULT_LIMIT = 15;
const MAX_LIMIT = 100;

function buildNotificationsScript(limit, typeKey) {
    const typeMeta = NOTIFICATION_TYPES[typeKey];
    return `
(async () => {
  const limit = ${Number(limit)};
  const maxPages = ${MAX_PAGES};
  const SERVER_PAGE_MAX = ${SERVER_PAGE_MAX};
  const pageSize = limit < SERVER_PAGE_MAX ? limit : SERVER_PAGE_MAX;
  const noticeType = ${Number(typeMeta.code)};
  const noticeLabel = ${JSON.stringify(typeMeta.label)};
  const aid = ${JSON.stringify(TIKTOK_AID)};

  ${BROWSER_HELPERS}
  ${NOTIFICATION_NORMALIZER}

  function collectFromState(root) {
    if (!root) return [];
    const out = [];
    walkObjects(root, (node) => {
      if (Array.isArray(node)) return false;
      if (Array.isArray(node.noticeList)) {
        for (const entry of node.noticeList) out.push(entry);
      }
      if (Array.isArray(node.notice_list)) {
        for (const entry of node.notice_list) out.push(entry);
      }
      return false;
    });
    return out;
  }

  const dedup = new Map();
  const universal = findUniversalData();
  for (const item of collectFromState(universal)) {
    const row = normalizeNotification(item, dedup.size + 1);
    if (row && !dedup.has(row.id)) dedup.set(row.id, row);
  }

  let apiFailure = null;
  const msToken = getCookie('msToken');
  let maxTime = 0;
  for (let page = 0; page < maxPages && dedup.size < limit; page += 1) {
    const params = new URLSearchParams({
      aid,
      notice_type: String(noticeType),
      count: String(pageSize),
      max_time: String(maxTime),
    });
    if (msToken) params.set('msToken', msToken);
    try {
      const data = await fetchJson('/api/notice/multi/?' + params.toString());
      assertTikTokApiSuccess(data, 'notice');
      const list = Array.isArray(data.notice_list_v1)
        ? data.notice_list_v1
        : (Array.isArray(data.noticeList) ? data.noticeList : (Array.isArray(data.notice_list) ? data.notice_list : []));
      if (list.length === 0) break;
      for (const entry of list) {
        const row = normalizeNotification(entry, dedup.size + 1);
        if (row && !dedup.has(row.id)) dedup.set(row.id, row);
      }
      if (data.has_more !== true && data.hasMore !== true) break;
      maxTime = asNumber(data.min_time) ?? asNumber(data.maxTime) ?? maxTime + list.length;
    } catch (error) {
      apiFailure = error instanceof Error ? error.message : String(error);
      break;
    }
  }

  const rows = Array.from(dedup.values())
    .slice(0, limit)
    .map((row, index) => ({ ...row, index: index + 1 }));

  if (rows.length === 0) {
    const suffix = apiFailure ? ' (notice API failed: ' + apiFailure + ')' : '';
    throw new Error('No notifications returned for ' + noticeLabel + suffix);
  }
  return rows;
})()
`;
}

async function listNotifications(page, args) {
    const limit = requireLimit(args.limit, { fallback: DEFAULT_LIMIT, max: MAX_LIMIT });
    const typeKey = requireNotificationType(args.type);
    await page.goto('https://www.tiktok.com/foryou', { waitUntil: 'load', settleMs: 5000 });
    let rows;
    try {
        rows = await page.evaluate(buildNotificationsScript(limit, typeKey));
    } catch (error) {
        throwTikTokPageContextError(error, {
            authMessage: 'TikTok requires login to read notifications',
            emptyPattern: /No notifications returned/,
            emptyTarget: 'tiktok notifications',
            failureMessage: 'Failed to load TikTok notifications',
        });
    }
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new EmptyResultError('tiktok notifications', 'TikTok returned no notifications');
    }
    return rows;
}

export const notificationsCommand = cli({
    site: 'tiktok',
    name: 'notifications',
    access: 'read',
    description: 'Read TikTok inbox notifications (likes, comments, mentions, followers) via page-context APIs',
    domain: 'www.tiktok.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: `Number of notifications (max ${MAX_LIMIT})` },
        {
            name: 'type',
            default: 'all',
            help: 'Notification type',
            choices: Object.keys(NOTIFICATION_TYPES),
        },
    ],
    columns: ['index', 'id', 'from', 'text', 'createTime'],
    func: listNotifications,
});

export const __test__ = {
    buildNotificationsScript,
    DEFAULT_LIMIT,
    MAX_LIMIT,
};
