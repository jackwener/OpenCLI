import { EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy, type CommandArgs } from '@jackwener/opencli/registry';
import type { IPage } from '@jackwener/opencli/types';
import {
  buildTiebaPostCardsFromPagePc,
  buildTiebaPostItems,
  normalizeTiebaLimit,
  signTiebaPcParams,
  type RawTiebaPagePcFeedEntry,
} from './utils.js';

interface TiebaPagePcResponse {
  error_code?: number;
  page_data?: {
    feed_list?: RawTiebaPagePcFeedEntry[];
  };
}

function getForumPageNumber(kwargs: CommandArgs): number {
  return Math.max(1, Number(kwargs.page || 1));
}

function getForumUrl(kwargs: CommandArgs): string {
  const forum = String(kwargs.forum || '');
  return `https://tieba.baidu.com/f?kw=${encodeURIComponent(forum)}&ie=utf-8&pn=${(getForumPageNumber(kwargs) - 1) * 50}`;
}

/**
 * Rebuild the signed page_pc request instead of scraping only the visible thread cards.
 */
function buildTiebaPagePcParams(kwargs: CommandArgs, limit: number): Record<string, string> {
  return {
    kw: encodeURIComponent(String(kwargs.forum || '')),
    pn: String(getForumPageNumber(kwargs)),
    sort_type: '-1',
    is_newfrs: '1',
    is_newfeed: '1',
    rn: '30',
    rn_need: String(Math.min(Math.max(limit + 10, 10), 30)),
    tbs: '',
    subapp_type: 'pc',
    _client_type: '20',
  };
}

/**
 * Tieba expects the signed forum-list request to be replayed with the browser's cookies.
 */
async function fetchTiebaPagePc(page: IPage, kwargs: CommandArgs, limit: number): Promise<TiebaPagePcResponse> {
  await page.goto(getForumUrl(kwargs), { waitUntil: 'none' });
  await page.wait(2);

  const params = buildTiebaPagePcParams(kwargs, limit);
  const cookies = await page.getCookies({ domain: 'tieba.baidu.com' });
  const cookieHeader = cookies.map((item) => `${item.name}=${item.value}`).join('; ');
  const body = new URLSearchParams({
    ...params,
    sign: signTiebaPcParams(params),
  }).toString();

  const response = await fetch('https://tieba.baidu.com/c/f/frs/page_pc', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
      cookie: cookieHeader,
      'x-requested-with': 'XMLHttpRequest',
      referer: getForumUrl(kwargs),
      'user-agent': 'Mozilla/5.0',
    },
    body,
  });

  const text = await response.text();
  try {
    return JSON.parse(text) as TiebaPagePcResponse;
  } catch {
    return {};
  }
}

cli({
  site: 'tieba',
  name: 'posts',
  description: 'Browse posts in a tieba forum',
  domain: 'tieba.baidu.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'forum', positional: true, required: true, type: 'string', help: 'Forum name in Chinese' },
    { name: 'page', type: 'int', default: 1, help: 'Page number' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of items to return' },
  ],
  columns: ['rank', 'title', 'author', 'replies'],
  func: async (page, kwargs) => {
    const limit = normalizeTiebaLimit(kwargs.limit);
    const payload = await fetchTiebaPagePc(page, kwargs, limit);
    const rawFeeds = Array.isArray(payload.page_data?.feed_list) ? payload.page_data.feed_list : [];
    const rawCards = buildTiebaPostCardsFromPagePc(rawFeeds);
    const items = buildTiebaPostItems(rawCards, limit);

    if (!items.length || payload.error_code) {
      throw new EmptyResultError('tieba posts', 'Tieba may have blocked the forum page, or the DOM structure may have changed');
    }

    return items;
  },
});
