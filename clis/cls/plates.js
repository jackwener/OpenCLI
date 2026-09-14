import { cli, Strategy } from '@jackwener/opencli/registry';
import { CLS_DOMAIN, fetchHomePageProps, mapHotPlateRows, normalizeLimit } from './utils.js';

cli({
  site: 'cls',
  name: 'plates',
  access: 'read',
  description: '财联社首页热门板块和主力资金，默认返回前 10 条',
  domain: CLS_DOMAIN,
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 10, help: '返回数量 (max 30)' },
  ],
  columns: ['rank', 'code', 'name', 'changePct', 'mainFundDiff', 'upStocks', 'url'],
  func: async (args) => {
    const limit = normalizeLimit(args.limit, 10, 30);
    const pageProps = await fetchHomePageProps('cls plates');
    return mapHotPlateRows(pageProps.hotPlate, limit);
  },
});
