import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'binance',
  name: 'prices',
    access: 'read',
  description: 'Latest prices for all trading pairs',
  domain: 'data-api.binance.vision',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of prices' },
  ],
  columns: ['rank', 'symbol', 'price'],
  pipeline: [
    { fetch: { url: 'https://data-api.binance.vision/api/v3/ticker/price' } },
    { map: { rank: '${{ index + 1 }}', symbol: '${{ item.symbol }}', price: '${{ item.price }}' } },
    { limit: '${{ args.limit }}' },
  ],
});
