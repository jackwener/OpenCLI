import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchRankedTickers } from './market.js';

cli({
  site: 'binance',
  name: 'top',
    access: 'read',
  description: 'Top trading pairs by 24h volume on Binance',
  domain: 'data-api.binance.vision',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of trading pairs' },
  ],
  columns: ['rank', 'symbol', 'price', 'change_24h', 'high', 'low', 'volume'],
  func: async (kwargs) => (await fetchRankedTickers(kwargs.limit)).map((ticker, index) => ({
    rank: index + 1,
    symbol: ticker.symbol,
    price: ticker.lastPrice,
    change_24h: ticker.priceChangePercent,
    high: ticker.highPrice,
    low: ticker.lowPrice,
    volume: ticker.quoteVolume,
  })),
});
