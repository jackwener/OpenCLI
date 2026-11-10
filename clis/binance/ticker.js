import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchRankedTickers } from './market.js';

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
  func: async (kwargs) => (await fetchRankedTickers(kwargs.limit)).map(ticker => ({
    symbol: ticker.symbol,
    price: ticker.lastPrice,
    change_pct: ticker.priceChangePercent,
    high: ticker.highPrice,
    low: ticker.lowPrice,
    volume: ticker.volume,
    quote_vol: ticker.quoteVolume,
    trades: ticker.count,
  })),
});
