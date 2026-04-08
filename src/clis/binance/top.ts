import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'binance',
  name: 'top',
  description: 'Top trading pairs by 24h volume on Binance',
  domain: 'data-api.binance.vision',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of trading pairs' },
  ],
  columns: ['rank', 'symbol', 'price', 'change_24h', 'high', 'low', 'volume'],
  pipeline: [
    { fetch: { url: 'https://data-api.binance.vision/api/v3/ticker/24hr' } },
    { map: { symbol: '${{ item.symbol }}', price: '${{ item.lastPrice }}', change_24h: '${{ item.priceChangePercent }}', high: '${{ item.highPrice }}', low: '${{ item.lowPrice }}', volume: '${{ item.quoteVolume }}', sort_volume: '${{ Number(item.quoteVolume) }}' } },
    { sort: { by: 'sort_volume', order: 'desc' } },
    { map: { rank: '${{ index + 1 }}', symbol: '${{ item.symbol }}', price: '${{ item.lastPrice }}', change_24h: '${{ item.priceChangePercent }}', high: '${{ item.highPrice }}', low: '${{ item.lowPrice }}', volume: '${{ item.quoteVolume }}' } },
    { limit: '${{ args.limit }}' },
  ],
});
