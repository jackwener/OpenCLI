import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'binance',
  name: 'ticker',
    access: 'read',
  description: '24h ticker statistics for top trading pairs by volume',
  domain: 'data-api.binance.vision',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of tickers' },
  ],
  columns: ['symbol', 'price', 'change_pct', 'high', 'low', 'volume', 'quote_vol', 'trades'],
  pipeline: [
    { fetch: { url: 'https://data-api.binance.vision/api/v3/ticker/24hr' } },
    { map: { symbol: '${{ item.symbol }}', price: '${{ item.lastPrice }}', change_pct: '${{ item.priceChangePercent }}', high: '${{ item.highPrice }}', low: '${{ item.lowPrice }}', volume: '${{ item.volume }}', quote_vol: '${{ item.quoteVolume }}', trades: '${{ item.count }}', sort_volume: '${{ Number(item.quoteVolume) }}' } },
    { sort: { by: 'sort_volume', order: 'desc' } },
    { map: { symbol: '${{ item.symbol }}', price: '${{ item.lastPrice }}', change_pct: '${{ item.priceChangePercent }}', high: '${{ item.highPrice }}', low: '${{ item.lowPrice }}', volume: '${{ item.volume }}', quote_vol: '${{ item.quoteVolume }}', trades: '${{ item.count }}' } },
    { limit: '${{ args.limit }}' },
  ],
});
