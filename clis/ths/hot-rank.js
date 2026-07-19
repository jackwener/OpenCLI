import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

const THS_HOT_API_URL = 'https://dq.10jqka.com.cn/fuyao/hot_list_data/out/hot_list/v1/stock?stock_type=a&type=hour&list_type=normal';

function tagsFromStock(stock) {
  const tag = stock?.tag && typeof stock.tag === 'object' ? stock.tag : {};
  return [
    ...(Array.isArray(tag.concept_tag) ? tag.concept_tag : []),
    ...(Array.isArray(tag.popularity_tag) ? tag.popularity_tag : []),
  ].filter(Boolean).join(',');
}

function parseLimit(raw) {
  const limit = Number(raw ?? 20);
  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new CliError('INVALID_ARGUMENT', '--limit must be a positive integer no greater than 100');
  }
  return limit;
}

cli({
  site: 'ths',
  name: 'hot-rank',
    access: 'read',
  description: '同花顺热股榜',
  domain: 'dq.10jqka.com.cn',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 20, help: '返回数量' },
  ],
  columns: ['rank', 'name', 'changePercent', 'heat', 'tags'],
  func: async (args) => {
    const limit = parseLimit(args.limit);
    const resp = await fetch(THS_HOT_API_URL, {
      headers: {
        'Accept': 'application/json,text/plain,*/*',
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://eq.10jqka.com.cn/',
      },
    });
    if (!resp.ok) throw new CliError('HTTP_ERROR', `ths hot-rank failed: HTTP ${resp.status}`);
    const payload = await resp.json();
    const stocks = Array.isArray(payload?.data?.stock_list) ? payload.data.stock_list : [];
    if (stocks.length === 0) throw new CliError('NO_DATA', 'ths hot-rank API returned no stock data');

    return stocks.slice(0, limit).map((stock, index) => ({
      rank: stock.order ?? index + 1,
      name: stock.name ?? '',
      changePercent: stock.rise_and_fall ?? '',
      heat: stock.rate ?? '',
      tags: tagsFromStock(stock),
    }));
  },
});

export const __test__ = {
  THS_HOT_API_URL,
  parseLimit,
  tagsFromStock,
};
