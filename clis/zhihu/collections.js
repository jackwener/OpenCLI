import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { log } from '@jackwener/opencli/logger';

function validatePositiveInt(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ArgumentError(`zhihu collections --${name} must be a positive integer`, 'Example: opencli zhihu collections --limit 20');
  }
  return n;
}

async function fetchJson(page, url, errorLabel) {
  const data = await page.evaluate(`
    (async () => {
      const r = await fetch(${JSON.stringify(url)}, { credentials: 'include' });
      if (!r.ok) return { __httpError: r.status };
      return await r.json();
    })()
  `);

  if (!data || data.__httpError) {
    const status = data?.__httpError;
    if (status === 401 || status === 403) {
      throw new AuthRequiredError('www.zhihu.com', `${errorLabel} from Zhihu failed. Please ensure you are logged in.`);
    }
    throw new CommandExecutionError(
      status ? `${errorLabel} from Zhihu failed (HTTP ${status})` : `${errorLabel} from Zhihu failed`,
      'Try again later or rerun with -v for more detail',
    );
  }
  return data;
}

function collectionKey(item) {
  return String(item?.id || item?.url || item?.title || '');
}

cli({
  site: 'zhihu',
  name: 'collections',
  description: '知乎收藏夹列表（需要登录）',
  domain: 'www.zhihu.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 20, help: '每页数量（最大 20）' },
  ],
  columns: ['rank', 'title', 'item_count', 'description', 'collection_id'],
  func: async (page, kwargs) => {
    const { limit = 20 } = kwargs;
    const requestedLimit = validatePositiveInt(limit, 'limit');

    // 先访问知乎主页建立 session
    await page.goto('https://www.zhihu.com');
    // 获取当前用户的 url_token
    const meData = await fetchJson(page, 'https://www.zhihu.com/api/v4/me?include=url_token', 'Zhihu user info request');

    const urlToken = meData.url_token;
    if (!urlToken) {
      throw new CommandExecutionError('Failed to get user url_token from Zhihu', 'Please ensure you are logged in.');
    }

    const collected = [];
    const seen = new Set();
    let totals = 0;
    let offset = 0;
    const pageLimit = Math.min(requestedLimit, 20);
    const maxPages = Math.ceil(requestedLimit / pageLimit) + 2;

    for (let pageIndex = 0; pageIndex < maxPages && collected.length < requestedLimit; pageIndex += 1) {
      const currentFetchLimit = Math.min(pageLimit, requestedLimit - collected.length);
      const url = `https://www.zhihu.com/api/v4/people/${urlToken}/collections?include=data%5B*%5D.updated_time&offset=${offset}&limit=${currentFetchLimit}`;
      const data = await fetchJson(page, url, 'Zhihu favorite collections request');
      const items = Array.isArray(data.data) ? data.data : [];
      const paging = data.paging || {};
      totals = Number(paging.totals || totals || 0);

      for (const item of items) {
        const key = collectionKey(item);
        if (key && !seen.has(key)) {
          seen.add(key);
          collected.push(item);
        }
        if (collected.length >= requestedLimit) break;
      }

      if (items.length === 0 || paging.is_end || collected.length >= requestedLimit) break;
      if (typeof paging.next === 'string') {
        try {
          const nextUrl = new URL(paging.next);
          const parsedOffset = Number(nextUrl.searchParams.get('offset'));
          if (Number.isInteger(parsedOffset) && parsedOffset > offset) {
            offset = parsedOffset;
            continue;
          }
        } catch {}
      }
      if (items.length < currentFetchLimit) break;
      const fallbackOffset = offset + items.length;
      if (fallbackOffset <= offset) break;
      offset = fallbackOffset;
      if (totals && offset >= totals) break;
    }

    if (totals > 0) {
      log.info(`共有 ${totals} 个收藏夹`);
    }

    if (collected.length === 0) {
      throw new EmptyResultError('zhihu collections', 'No favorite collections were returned for the logged-in user.');
    }

    return collected.slice(0, requestedLimit).map((item, i) => ({
      rank: i + 1,
      title: item.title || '未命名',
      item_count: item.item_count ?? item.answer_count ?? 0,
      description: item.description || '',
      collection_id: String(item.id || ''),
    }));
  },
});

export const __test__ = {
  validatePositiveInt,
  collectionKey,
};
