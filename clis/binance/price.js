import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'binance',
  name: 'price',
    access: 'read',
  description: 'Quick price check for a trading pair',
  domain: 'data-api.binance.vision',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'symbol', type: 'str', required: true, positional: true, help: 'Trading pair symbol (e.g. BTCUSDT, ETHUSDT)' },
  ],
  columns: ['symbol', 'price', 'change', 'change_pct', 'high', 'low', 'volume', 'quote_volume', 'trades'],
  pipeline: [
    { fetch: { url: 'https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${{ args.symbol }}' } },
    { map: { symbol: '${{ item.symbol }}', price: '${{ item.lastPrice }}', change: '${{ item.priceChange }}', change_pct: '${{ item.priceChangePercent }}', high: '${{ item.highPrice }}', low: '${{ item.lowPrice }}', volume: '${{ item.volume }}', quote_volume: '${{ item.quoteVolume }}', trades: '${{ item.count }}' } },
  ],
});
