import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'binance',
  name: 'pairs',
    access: 'read',
  description: 'List active trading pairs on Binance',
  domain: 'data-api.binance.vision',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of trading pairs' },
  ],
  columns: ['symbol', 'base', 'quote', 'status'],
  pipeline: [
    { fetch: { url: 'https://data-api.binance.vision/api/v3/exchangeInfo' } },
    { select: 'symbols' },
    { filter: 'item.status === \'TRADING\'' },
    { map: { symbol: '${{ item.symbol }}', base: '${{ item.baseAsset }}', quote: '${{ item.quoteAsset }}', status: '${{ item.status }}' } },
    { limit: '${{ args.limit }}' },
  ],
});
