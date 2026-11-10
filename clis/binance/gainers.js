import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchRankedTickers } from './market.js';

cli({
  site: 'binance',
  name: 'gainers',
    access: 'read',
  description: 'Top gaining trading pairs by 24h price change',
  domain: 'data-api.binance.vision',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 10, help: 'Number of trading pairs' },
  ],
  columns: ['rank', 'symbol', 'price', 'change_24h', 'volume'],
  func: async (kwargs) => (await fetchRankedTickers(kwargs.limit, 'priceChangePercent')).map((ticker, index) => ({
    rank: index + 1,
    symbol: ticker.symbol,
    price: ticker.lastPrice,
    change_24h: ticker.priceChangePercent,
    volume: ticker.quoteVolume,
  })),
});
