import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'binance',
  name: 'trades',
  description: 'Recent trades for a trading pair',
  domain: 'data-api.binance.vision',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'symbol', type: 'str', required: true, positional: true, help: 'Trading pair symbol (e.g. BTCUSDT, ETHUSDT)' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of trades (max 1000)' },
  ],
  columns: ['id', 'price', 'qty', 'quote_qty', 'buyer_maker'],
  pipeline: [
    { fetch: { url: 'https://data-api.binance.vision/api/v3/trades?symbol=${{ args.symbol }}&limit=${{ args.limit }}' } },
    { map: { id: '${{ item.id }}', price: '${{ item.price }}', qty: '${{ item.qty }}', quote_qty: '${{ item.quoteQty }}', buyer_maker: '${{ item.isBuyerMaker }}' } },
    { limit: '${{ args.limit }}' },
  ],
});
