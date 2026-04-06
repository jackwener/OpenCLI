import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CliError } from '@jackwener/opencli/errors';
import { log } from '@jackwener/opencli/logger';

function stripHtml(html: string): string {
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
  name: 'collection',
  description: '知乎收藏夹内容列表（需要登录）',
  domain: 'www.zhihu.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'id', required: true, positional: true, help: '收藏夹 ID (数字，可从收藏夹 URL 中获取)' },
    { name: 'offset', type: 'int', default: 0, help: '起始偏移量（用于分页）' },
    { name: 'limit', type: 'int', default: 20, help: '每页数量（最大 20）' },
  ],
  columns: ['rank', 'type', 'title', 'author', 'votes', 'excerpt', 'url'],
  func: async (page, kwargs) => {
    const { id, offset = 0, limit = 20 } = kwargs;
    const collectionId = String(id);
    
    // 验证收藏夹 ID 为数字
    if (!/^\d+$/.test(collectionId)) {
      throw new CliError('INVALID_INPUT', 'Collection ID must be numeric', 'Example: opencli zhihu collection 83283292');
    }
    
    const pageOffset = Number(offset);
    const pageLimit = Math.min(Number(limit), 20); // 知乎 API 限制每页最大 20

    // 先访问知乎主页建立 session
    await page.goto('https://www.zhihu.com');

    // 调用知乎收藏夹 API
    const url = `https://www.zhihu.com/api/v4/collections/${collectionId}/items?offset=${pageOffset}&limit=${pageLimit}`;
    const data: any = await page.evaluate(`
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
      throw new CliError(
        'FETCH_ERROR',
        status ? `Zhihu collection request failed (HTTP ${status})` : 'Zhihu collection request failed',
        'Try again later or rerun with -v for more detail',
      );
    }

    // 处理返回的数据
    const items = data.data || [];
    const paging = data.paging || {};
    const totals = paging.totals || 0;
    
    // 计算总页数
    const totalPages = Math.ceil(totals / pageLimit);
    const currentPage = Math.floor(pageOffset / pageLimit) + 1;
    
    // 输出统计信息
    if (totals > 0) {
      log.info(`收藏夹共有 ${totals} 条内容，共 ${totalPages} 页`);
      log.info(`当前第 ${currentPage} 页，显示第 ${pageOffset + 1} - ${Math.min(pageOffset + items.length, totals)} 条`);
    } else {
      log.info('收藏夹为空');
    }
    
    // 如果没有数据且不是第一页，可能是 offset 超出范围
    if (items.length === 0 && pageOffset > 0 && totals === 0) {
      return [];
    }

    return items.map((item: any, i: number) => {
      const content = item.content || {};
      const type = content.type || 'unknown';
      
      let title = '';
      let excerpt = '';
      let url = '';
      let author = '';
      let votes = 0;
      
      if (type === 'answer') {
        // 回答类型
        const question = content.question || {};
        title = question.title || '';
        excerpt = stripHtml(content.content || '').substring(0, 150);
        url = content.url || `https://www.zhihu.com/question/${question.id}/answer/${content.id}`;
        author = content.author?.name || '匿名用户';
        votes = content.voteup_count || 0;
      } else if (type === 'article') {
        // 文章类型
        title = content.title || '';
        excerpt = stripHtml(content.content || '').substring(0, 150);
        url = content.url || `https://zhuanlan.zhihu.com/p/${content.id}`;
        author = content.author?.name || '匿名用户';
        votes = content.voteup_count || 0;
      } else if (type === 'pin') {
        // 想法类型
        title = '想法';
        excerpt = stripHtml((content.content || []).map((c: any) => c.content || '').join(' ')).substring(0, 150);
        url = content.url || `https://www.zhihu.com/pin/${content.id}`;
        author = content.author?.name || '匿名用户';
        votes = content.reaction_count || 0;
      }
      
      return {
        rank: pageOffset + i + 1,
        type,
        title: title.substring(0, 100),
        author,
        votes,
        excerpt,
        url,
      };
    });
  },
});
