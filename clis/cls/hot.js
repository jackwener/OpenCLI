import { cli, Strategy } from '@jackwener/opencli/registry';
import { CLS_DOMAIN, fetchHomePageProps, mapHotArticleRows, normalizeLimit } from './utils.js';

cli({
  site: 'cls',
  name: 'hot',
  access: 'read',
  description: '财联社首页热门文章，默认返回前 10 条',
  domain: CLS_DOMAIN,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 10, help: '返回数量 (max 30)' },
  ],
  columns: ['rank', 'id', 'title', 'brief', 'author', 'readingCount', 'pubTime', 'url'],
  func: async (args) => {
    const limit = normalizeLimit(args.limit, 10, 30);
    const pageProps = await fetchHomePageProps('cls hot');
    return mapHotArticleRows(pageProps.hotArticleData, limit);
  },
});
