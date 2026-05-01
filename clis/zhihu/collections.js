import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CliError } from '@jackwener/opencli/errors';
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
  columns: ['rank', 'title', 'answer_count', 'description', 'collection_id'],
  func: async (page, kwargs) => {
    const { limit = 20 } = kwargs;

    // 先访问知乎主页建立 session
    await page.goto('https://www.zhihu.com');
    // 获取当前用户的 url_token
    const meData = await page.evaluate(`
      (async () => {
        const r = await fetch('https://www.zhihu.com/api/v4/me?include=url_token', { credentials: 'include' });
        if (!r.ok) return { __httpError: r.status };
        return await r.json();
      })()
    `);

    if (!meData || meData.__httpError) {
      const status = meData?.__httpError;
      if (status === 401 || status === 403) {
        throw new AuthRequiredError('www.zhihu.com', 'Failed to fetch user info from Zhihu. Please ensure you are logged in.');
      }
      throw new CliError(
        'FETCH_ERROR',
        status ? `Zhihu user info request failed (HTTP ${status})` : 'Zhihu user info request failed',
        'Try again later or rerun with -v for more detail',
      );
    }

    const urlToken = meData.url_token;
    if (!urlToken) {
      throw new CliError('FETCH_ERROR', 'Failed to get user url_token from Zhihu', 'Please ensure you are logged in.');
    }

    const url = `https://www.zhihu.com/api/v4/people/${urlToken}/collections?include=data%5B*%5D.updated_time&offset=0&limit=${Math.min(Number(limit), 20)}`;
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
        throw new AuthRequiredError('www.zhihu.com', 'Failed to fetch favorite collections from Zhihu. Please ensure you are logged in.');
      }
      throw new CliError(
        'FETCH_ERROR',
        status ? `Zhihu favorite collections request failed (HTTP ${status})` : 'Zhihu favorite collections request failed',
        'Try again later or rerun with -v for more detail',
      );
    }

    const items = data.data || [];
    const paging = data.paging || {};
    const totals = paging.totals || 0;

    if (totals > 0) {
      log.info(`共有 ${totals} 个收藏夹`);
    } else {
      log.info('暂无收藏夹');
    }

    return items.map((item, i) => ({
      rank: i + 1,
      title: item.title || '未命名',
      answer_count: item.answer_count || 0,
      description: item.description || '',
      collection_id: String(item.id || ''),
    }));
  },
});
