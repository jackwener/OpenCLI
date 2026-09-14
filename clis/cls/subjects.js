import { cli, Strategy } from '@jackwener/opencli/registry';
import { CLS_DOMAIN, fetchHomePageProps, mapHotSubjectRows, normalizeLimit } from './utils.js';

cli({
  site: 'cls',
  name: 'subjects',
  access: 'read',
  description: '财联社首页热门话题，默认返回前 10 条',
  domain: CLS_DOMAIN,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 10, help: '返回数量 (max 30)' },
  ],
  columns: ['rank', 'id', 'name', 'description', 'attentionCount', 'newestArticleId', 'newestArticleTitle', 'url'],
  func: async (args) => {
    const limit = normalizeLimit(args.limit, 10, 30);
    const pageProps = await fetchHomePageProps('cls subjects');
    return mapHotSubjectRows(pageProps.hotSubject, limit);
  },
});
