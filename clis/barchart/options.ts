/**
 * Barchart options chain — strike, bid/ask, volume, OI, greeks, IV.
 * Auth: CSRF token from <meta name="csrf-token"> + session cookies.
 */
import { cli, Strategy } from '../../src/registry.js';

cli({
  site: 'barchart',
  name: 'options',
  description: 'Barchart options chain with greeks, IV, volume, and open interest',
  domain: 'www.barchart.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'symbol', required: true, positional: true, help: 'Stock ticker (e.g. AAPL)' },
    { name: 'type', type: 'str', default: 'Call', help: 'Option type: Call or Put', choices: ['Call', 'Put'] },
    { name: 'limit', type: 'int', default: 20, help: 'Max number of strikes to return' },
  ],
  columns: [
    'strike', 'bid', 'ask', 'last', 'change', 'volume', 'openInterest',
    'iv', 'delta', 'gamma', 'theta', 'vega', 'expiration',
  ],
  func: async (page, kwargs) => {
    const symbol = kwargs.symbol.toUpperCase().trim();
    const optType = kwargs.type || 'Call';
    const limit = kwargs.limit ?? 20;

    await page.goto(`https://www.barchart.com/stocks/quotes/${encodeURIComponent(symbol)}/options`);
    await page.wait(4);

    const data = await page.evaluate(`
      (async () => {
        const sym = '${symbol}';
        const type = '${optType}';
        const limit = ${limit};
        const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
        const headers = { 'X-CSRF-TOKEN': csrf };

        // API: options chain with greeks
        try {
          const fields = [
            'strikePrice','bidPrice','askPrice','lastPrice','priceChange',
            'volume','openInterest','volatility',
            'delta','gamma','theta','vega',
            'expirationDate','optionType','percentFromLast',
          ].join(',');

          const url = '/proxies/core-api/v1/options/chain?symbol=' + encodeURIComponent(sym)
            + '&fields=' + fields + '&raw=1';
          const resp = await fetch(url, { credentials: 'include', headers });
          if (resp.ok) {
            const d = await resp.json();
            let items = d?.data || [];

            // Filter by type
            items = items.filter(i => {
              const t = (i.raw || i).optionType || '';
              return t.toLowerCase() === type.toLowerCase();
            });

            // Sort by closeness to current price
            items.sort((a, b) => {
              const aD = Math.abs((a.raw || a).percentFromLast || 999);
              const bD = Math.abs((b.raw || b).percentFromLast || 999);
              return aD - bD;
            });

            return items.slice(0, limit).map(i => {
              const r = i.raw || i;
              return {
                strike: r.strikePrice,
                bid: r.bidPrice,
                ask: r.askPrice,
                last: r.lastPrice,
                change: r.priceChange,
                volume: r.volume,
                openInterest: r.openInterest,
                iv: r.volatility,
                delta: r.delta,
                gamma: r.gamma,
                theta: r.theta,
                vega: r.vega,
                expiration: r.expirationDate,
              };
            });
          }
        } catch(e) {}

        return [];
      })()
    `);

    if (!data || !Array.isArray(data)) return [];

    return data.map(r => ({
      strike: r.strike,
      bid: r.bid != null ? Number(Number(r.bid).toFixed(2)) : null,
      ask: r.ask != null ? Number(Number(r.ask).toFixed(2)) : null,
      last: r.last != null ? Number(Number(r.last).toFixed(2)) : null,
      change: r.change != null ? Number(Number(r.change).toFixed(2)) : null,
      volume: r.volume,
      openInterest: r.openInterest,
      iv: r.iv != null ? Number(Number(r.iv).toFixed(2)) + '%' : null,
      delta: r.delta != null ? Number(Number(r.delta).toFixed(4)) : null,
      gamma: r.gamma != null ? Number(Number(r.gamma).toFixed(4)) : null,
      theta: r.theta != null ? Number(Number(r.theta).toFixed(4)) : null,
      vega: r.vega != null ? Number(Number(r.vega).toFixed(4)) : null,
      expiration: r.expiration ?? null,
    }));
  },
});
