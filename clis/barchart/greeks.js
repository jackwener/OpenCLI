/**
 * Barchart options greeks overview — IV, delta, gamma, theta, vega, rho
 * for near-the-money options on a given symbol.
 * Auth: CSRF token from <meta name="csrf-token"> + session cookies.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'barchart',
    name: 'greeks',
    access: 'read',
    description: 'Barchart options greeks overview (IV, delta, gamma, theta, vega)',
    domain: 'www.barchart.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'symbol', required: true, positional: true, help: 'Stock ticker (e.g. AAPL)' },
        { name: 'expiration', type: 'str', help: 'Expiration date (YYYY-MM-DD). Defaults to the nearest available expiration.' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of near-the-money strikes per type' },
    ],
    columns: [
        'type', 'strike', 'last', 'iv', 'delta', 'gamma', 'theta', 'vega', 'rho',
        'volume', 'openInterest', 'expiration',
    ],
    func: async (page, kwargs) => {
        const symbol = kwargs.symbol.toUpperCase().trim();
        const expiration = kwargs.expiration ?? '';
        const limit = kwargs.limit ?? 10;
        await page.goto(`https://www.barchart.com/stocks/quotes/${encodeURIComponent(symbol)}/options`);
        await page.wait(4);
        const data = await page.evaluate(`
      (async () => {
        const sym = ${JSON.stringify(symbol)};
        const expDate = ${JSON.stringify(expiration)};
        const limit = ${limit};
        const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
        const headers = { 'X-CSRF-TOKEN': csrf };

        try {
          const fields = [
            'strikePrice','lastPrice','volume','openInterest',
            'volatility','delta','gamma','theta','vega','rho',
            'expirationDate','optionType','percentFromLast',
          ].join(',');

          let url = '/proxies/core-api/v1/options/chain?symbol=' + encodeURIComponent(sym)
            + '&fields=' + fields + '&raw=1';
          if (expDate) url += '&expirationDate=' + encodeURIComponent(expDate);
          const resp = await fetch(url, { credentials: 'include', headers });
          if (resp.ok) {
            const d = await resp.json();
            let items = d?.data || [];

            if (!expDate) {
              const expirations = items
                .map(i => (i.raw || i).expirationDate || null)
                .filter(Boolean)
                .sort((a, b) => {
                  const aTime = Date.parse(a);
                  const bTime = Date.parse(b);
                  if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0;
                  if (Number.isNaN(aTime)) return 1;
                  if (Number.isNaN(bTime)) return -1;
                  return aTime - bTime;
                });
              const nearestExpiration = expirations[0];
              if (nearestExpiration) {
                items = items.filter(i => ((i.raw || i).expirationDate || null) === nearestExpiration);
              }
            }

            // Separate calls and puts, sort by distance from current price
            const calls = items
              .filter(i => ((i.raw || i).optionType || '').toLowerCase() === 'call')
              .sort((a, b) => Math.abs((a.raw || a).percentFromLast || 999) - Math.abs((b.raw || b).percentFromLast || 999))
              .slice(0, limit);
            const puts = items
              .filter(i => ((i.raw || i).optionType || '').toLowerCase() === 'put')
              .sort((a, b) => Math.abs((a.raw || a).percentFromLast || 999) - Math.abs((b.raw || b).percentFromLast || 999))
              .slice(0, limit);

            return [...calls, ...puts].map(i => {
              const r = i.raw || i;
              return {
                type: r.optionType,
                strike: r.strikePrice,
                last: r.lastPrice,
                iv: r.volatility,
                delta: r.delta,
                gamma: r.gamma,
                theta: r.theta,
                vega: r.vega,
                rho: r.rho,
                volume: r.volume,
                openInterest: r.openInterest,
                expiration: r.expirationDate,
              };
            });
          }
        } catch(e) {}

        return [];
      })()
    `);
        if (!data || !Array.isArray(data))
            return [];
        return data.map(r => ({
            type: r.type || '',
            strike: r.strike,
            last: r.last != null ? Number(Number(r.last).toFixed(2)) : null,
            iv: r.iv != null ? Number(Number(r.iv).toFixed(2)) + '%' : null,
            delta: r.delta != null ? Number(Number(r.delta).toFixed(4)) : null,
            gamma: r.gamma != null ? Number(Number(r.gamma).toFixed(4)) : null,
            theta: r.theta != null ? Number(Number(r.theta).toFixed(4)) : null,
            vega: r.vega != null ? Number(Number(r.vega).toFixed(4)) : null,
            rho: r.rho != null ? Number(Number(r.rho).toFixed(4)) : null,
            volume: r.volume,
            openInterest: r.openInterest,
            expiration: r.expiration ?? null,
        }));
    },
});
