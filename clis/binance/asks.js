import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'binance',
  name: 'asks',
  description: 'Order book ask prices for a trading pair',
  domain: 'data-api.binance.vision',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'symbol', type: 'str', required: true, positional: true, help: 'Trading pair symbol (e.g. BTCUSDT, ETHUSDT)' },
    { name: 'limit', type: 'int', default: 10, help: 'Number of price levels (5, 10, 20, 50, 100)' },
  ],
  columns: ['rank', 'ask_price', 'ask_qty'],
  pipeline: [
    { fetch: { url: 'https://data-api.binance.vision/api/v3/depth?symbol=${{ args.symbol }}&limit=${{ args.limit }}' } },
    { select: 'asks' },
    { map: { rank: '${{ index + 1 }}', ask_price: '${{ item.0 }}', ask_qty: '${{ item.1 }}' } },
    { limit: '${{ args.limit }}' },
  ],
});
