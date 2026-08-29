import { cli, Strategy } from '@jackwener/opencli/registry';
import { CLS_DOMAIN, fetchHomePageProps, mapCalendarRows, normalizeLimit } from './utils.js';

cli({
  site: 'cls',
  name: 'calendar',
  access: 'read',
  description: '财联社首页投资日历事件，默认返回前 20 条',
  domain: CLS_DOMAIN,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 20, help: '返回数量 (max 100)' },
  ],
  columns: ['rank', 'id', 'date', 'week', 'time', 'title', 'country', 'star'],
  func: async (args) => {
    const limit = normalizeLimit(args.limit, 20, 100);
    const pageProps = await fetchHomePageProps('cls calendar');
    return mapCalendarRows(pageProps.investKalendarData, limit);
  },
});
