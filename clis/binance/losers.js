import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'binance',
  name: 'losers',
    access: 'read',
  description: 'Top losing trading pairs by 24h price change',
  domain: 'data-api.binance.vision',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 10, help: 'Number of trading pairs' },
  ],
  columns: ['rank', 'symbol', 'price', 'change_24h', 'volume'],
  pipeline: [
    { fetch: { url: 'https://data-api.binance.vision/api/v3/ticker/24hr' } },
    { filter: 'item.priceChangePercent' },
    { map: { symbol: '${{ item.symbol }}', price: '${{ item.lastPrice }}', change_24h: '${{ item.priceChangePercent }}', volume: '${{ item.quoteVolume }}', sort_change: '${{ Number(item.priceChangePercent) }}' } },
    { sort: { by: 'sort_change' } },
    { map: { rank: '${{ index + 1 }}', symbol: '${{ item.symbol }}', price: '${{ item.lastPrice }}', change_24h: '${{ item.priceChangePercent }}', volume: '${{ item.quoteVolume }}' } },
    { limit: '${{ args.limit }}' },
  ],
});
