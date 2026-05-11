import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { log } from '@jackwener/opencli/logger';

function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/<em>/g, '')
    .replace(/<\/em>/g, '')
    .trim();
}

function validatePositiveInt(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ArgumentError(`zhihu collection --${name} must be a positive integer`, 'Example: opencli zhihu collection 83283292 --limit 20');
  }
  return n;
}

function validateNonNegativeInt(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new ArgumentError(`zhihu collection --${name} must be a non-negative integer`, 'Example: opencli zhihu collection 83283292 --offset 0');
  }
  return n;
}

async function fetchCollectionPage(page, collectionId, offset, limit) {
  const url = `https://www.zhihu.com/api/v4/collections/${collectionId}/items?offset=${offset}&limit=${limit}`;
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
      throw new AuthRequiredError('www.zhihu.com', 'Failed to fetch collection data from Zhihu. Please ensure you are logged in.');
    }
    throw new CommandExecutionError(
      status ? `Zhihu collection request failed (HTTP ${status})` : 'Zhihu collection request failed',
      'Try again later or rerun with -v for more detail',
    );
  }
  return data;
}

function itemKey(item) {
  const content = item?.content || {};
  return `${content.type || 'unknown'}:${content.id || content.url || JSON.stringify(content).slice(0, 80)}`;
}

function mapCollectionItem(item, rank) {
  const content = item.content || {};
  const type = content.type || 'unknown';

  let title = '';
  let excerpt = '';
  let url = '';
  let author = '';
  let votes = 0;

  if (type === 'answer') {
    const question = content.question || {};
    title = question.title || '';
    excerpt = stripHtml(content.content || '').substring(0, 150);
    url = content.url || `https://www.zhihu.com/question/${question.id}/answer/${content.id}`;
    author = content.author?.name || '匿名用户';
    votes = content.voteup_count || 0;
  } else if (type === 'article') {
    title = content.title || '';
    excerpt = stripHtml(content.content || '').substring(0, 150);
    url = content.url || `https://zhuanlan.zhihu.com/p/${content.id}`;
    author = content.author?.name || '匿名用户';
    votes = content.voteup_count || 0;
  } else if (type === 'pin') {
    title = '想法';
    excerpt = stripHtml((content.content || []).map((c) => c.content || '').join(' ')).substring(0, 150);
    url = content.url || `https://www.zhihu.com/pin/${content.id}`;
    author = content.author?.name || '匿名用户';
    votes = content.reaction_count || 0;
  }

  return {
    rank,
    type,
    title: title.substring(0, 100),
    author,
    votes,
    excerpt,
    url,
  };
}

cli({
  site: 'zhihu',
  name: 'collection',
    access: 'read',
  description: '知乎收藏夹内容列表（需要登录）',
  domain: 'www.zhihu.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'id', positional: true, required: true, help: '收藏夹 ID (数字，可从收藏夹 URL 中获取)' },
    { name: 'offset', type: 'int', default: 0, help: '起始偏移量（用于分页）' },
    { name: 'limit', type: 'int', default: 20, help: '每页数量（最大 20）' },
  ],
  columns: ['rank', 'type', 'title', 'author', 'votes', 'excerpt', 'url'],
  func: async (page, kwargs) => {
    const { id, offset = 0, limit = 20 } = kwargs;

    const collectionId = String(id);

    // 验证收藏夹 ID 为数字
    if (!/^\d+$/.test(collectionId)) {
      throw new ArgumentError('Collection ID must be numeric', 'Example: opencli zhihu collection 83283292');
    }

    const pageOffset = validateNonNegativeInt(offset, 'offset');
    const requestedLimit = validatePositiveInt(limit, 'limit');
    const pageLimit = Math.min(requestedLimit, 20); // 知乎 API 限制每页最大 20

    // 先访问知乎主页建立 session
    await page.goto('https://www.zhihu.com');

    const collected = [];
    const seen = new Set();
    let totals = 0;
    let nextOffset = pageOffset;
    const maxPages = Math.ceil(requestedLimit / pageLimit) + 2;
    for (let pageIndex = 0; pageIndex < maxPages && collected.length < requestedLimit; pageIndex += 1) {
      const currentFetchLimit = Math.min(pageLimit, requestedLimit - collected.length);
      const data = await fetchCollectionPage(page, collectionId, nextOffset, currentFetchLimit);
      const items = Array.isArray(data.data) ? data.data : [];
      const paging = data.paging || {};
      totals = Number(paging.totals || totals || 0);

      for (const item of items) {
        const key = itemKey(item);
        if (!seen.has(key)) {
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
          if (Number.isInteger(parsedOffset) && parsedOffset > nextOffset) {
            nextOffset = parsedOffset;
            continue;
          }
        } catch {}
      }
      if (items.length < currentFetchLimit) break;
      const fallbackOffset = nextOffset + items.length;
      if (fallbackOffset <= nextOffset) break;
      nextOffset = fallbackOffset;
      if (totals && nextOffset >= totals) break;
    }
    
    // 计算总页数
    const totalPages = Math.ceil(totals / pageLimit);
    const currentPage = Math.floor(pageOffset / pageLimit) + 1;
    
    // 输出统计信息
    if (totals > 0) {
      log.info(`收藏夹共有 ${totals} 条内容，共 ${totalPages} 页`);
      log.info(`当前第 ${currentPage} 页，显示第 ${pageOffset + 1} - ${Math.min(pageOffset + collected.length, totals)} 条`);
    }

    if (collected.length === 0) {
      throw new EmptyResultError('zhihu collection', `No items found for collection ${collectionId}. The collection may be empty, private, or the offset may be out of range.`);
    }

    return collected.slice(0, requestedLimit).map((item, i) => mapCollectionItem(item, pageOffset + i + 1));
  },
});

export const __test__ = {
  stripHtml,
  validatePositiveInt,
  validateNonNegativeInt,
  itemKey,
  mapCollectionItem,
};
