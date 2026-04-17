import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'binance',
  name: 'klines',
  description: 'Candlestick/kline data for a trading pair',
  domain: 'data-api.binance.vision',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'symbol', type: 'str', required: true, positional: true, help: 'Trading pair symbol (e.g. BTCUSDT, ETHUSDT)' },
    { name: 'interval', type: 'str', default: '1d', help: 'Kline interval (1m, 5m, 15m, 1h, 4h, 1d, 1w, 1M)' },
    { name: 'limit', type: 'int', default: 10, help: 'Number of klines (max 1000)' },
  ],
  columns: ['open', 'high', 'low', 'close', 'volume'],
  pipeline: [
    { fetch: { url: 'https://data-api.binance.vision/api/v3/klines?symbol=${{ args.symbol }}&interval=${{ args.interval }}&limit=${{ args.limit }}' } },
    { map: { open: '${{ item.1 }}', high: '${{ item.2 }}', low: '${{ item.3 }}', close: '${{ item.4 }}', volume: '${{ item.5 }}' } },
    { limit: '${{ args.limit }}' },
  ],
});
