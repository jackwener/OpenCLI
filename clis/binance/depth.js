import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'binance',
  name: 'depth',
    access: 'read',
  description: 'Order book bid and ask prices for a trading pair',
  domain: 'data-api.binance.vision',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'symbol', type: 'str', required: true, positional: true, help: 'Trading pair symbol (e.g. BTCUSDT, ETHUSDT)' },
    { name: 'limit', type: 'int', default: 10, help: 'Number of price levels (5, 10, 20, 50, 100)' },
  ],
  columns: ['rank', 'bid_price', 'bid_qty', 'ask_price', 'ask_qty'],
  pipeline: [
    { fetch: { url: 'https://data-api.binance.vision/api/v3/depth?symbol=${{ args.symbol }}&limit=${{ args.limit }}' } },
    { map: { select: 'bids', rank: '${{ index + 1 }}', bid_price: '${{ item[0] }}', bid_qty: '${{ item[1] }}', ask_price: '${{ root.asks[index]?.[0] ?? "" }}', ask_qty: '${{ root.asks[index]?.[1] ?? "" }}' } },
    { limit: '${{ args.limit }}' },
  ],
});
