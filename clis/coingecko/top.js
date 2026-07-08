// coingecko top — top coins by market cap.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

cli({
  site: 'coingecko',
  name: 'top',
  access: 'read',
  description: '按市值排序的加密货币行情（默认 USD）',
  domain: 'api.coingecko.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'currency', type: 'string', default: 'usd', help: '计价币种 (usd / cny / eur / jpy ...)' },
    { name: 'limit',    type: 'int',    default: 10,    help: '返回数量（默认 10，最多 250）' },
  ],
  columns: ['rank', 'symbol', 'name', 'price', 'change24hPct', 'marketCap', 'volume24h', 'high24h', 'low24h'],
  func: async (args) => {
    const currency = String(args.currency ?? 'usd').toLowerCase();
    const limit = Number(args.limit ?? 10);
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new ArgumentError('limit must be a positive integer');
    }
    if (limit > 250) {
      throw new ArgumentError('limit must be <= 250 (CoinGecko per_page upper bound)');
    }

    const url = new URL('https://api.coingecko.com/api/v3/coins/markets');
    url.searchParams.set('vs_currency', currency);
    url.searchParams.set('order', 'market_cap_desc');
    url.searchParams.set('per_page', String(limit));
    url.searchParams.set('page', '1');
    url.searchParams.set('sparkline', 'false');

    let resp;
    try {
      resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    } catch (error) {
      throw new CommandExecutionError(`coingecko top request failed: ${error?.message || error}`);
    }
    if (!resp.ok) throw new CommandExecutionError(`coingecko top failed: HTTP ${resp.status}`);
    let data;
    try {
      data = await resp.json();
    } catch (error) {
      throw new CommandExecutionError(`coingecko returned malformed JSON: ${error?.message || error}`);
    }
    if (data?.error) throw new CommandExecutionError(`coingecko returned error: ${data.error}`);
    if (!Array.isArray(data)) throw new CommandExecutionError('coingecko returned an unexpected response');
    if (data.length === 0) throw new EmptyResultError('coingecko top', 'coingecko returned no market data');

    return data.map((c) => ({
      rank: c.market_cap_rank,
      symbol: String(c.symbol ?? '').toUpperCase(),
      name: c.name,
      price: c.current_price,
      change24hPct: c.price_change_percentage_24h,
      marketCap: c.market_cap,
      volume24h: c.total_volume,
      high24h: c.high_24h,
      low24h: c.low_24h,
    }));
  },
});
