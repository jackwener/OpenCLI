import { cli, Strategy } from '@jackwener/opencli/registry';
import {
  CLS_BASE,
  CLS_DOMAIN,
  extractArticleDetailFromNextData,
  fetchHtml,
  mapArticleDetailRow,
  parseArticleId,
} from './utils.js';

cli({
  site: 'cls',
  name: 'article',
  access: 'read',
  description: '读取财联社文章详情正文，支持文章 ID 或 detail URL',
  domain: CLS_DOMAIN,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'id', positional: true, required: true, help: '财联社文章 ID 或 https://www.cls.cn/detail/<id> URL' },
  ],
  columns: [
    'id',
    'title',
    'content',
    'brief',
    'subjects',
    'author',
    'level',
    'readingCount',
    'pubTime',
    'audioUrl',
    'url',
  ],
  func: async (args) => {
    const id = parseArticleId(args.id);
    const html = await fetchHtml(`${CLS_BASE}/detail/${id}`, 'cls article');
    const detail = extractArticleDetailFromNextData(html);
    return [mapArticleDetailRow(detail)];
  },
});
