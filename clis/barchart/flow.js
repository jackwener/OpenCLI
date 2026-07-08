/**
 * Barchart unusual options activity (options flow).
 * Shows high volume/OI ratio trades that may indicate institutional activity.
 * Auth: CSRF token from <meta name="csrf-token"> + session cookies.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'barchart',
    name: 'flow',
    access: 'read',
    description: 'Barchart unusual options activity / options flow',
    domain: 'www.barchart.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'type', type: 'str', default: 'all', help: 'Filter: all, call, or put', choices: ['all', 'call', 'put'] },
        { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
    ],
    columns: [
        'symbol', 'type', 'strike', 'expiration', 'last',
        'volume', 'openInterest', 'volOiRatio', 'iv',
    ],
    func: async (page, kwargs) => {
        const optionType = kwargs.type || 'all';
        const limit = kwargs.limit ?? 20;
        await page.goto('https://www.barchart.com/options/unusual-activity/stocks');
        await page.wait(5);
        const data = await page.evaluate(`
      (async () => {
        const limit = ${limit};
        const typeFilter = ${JSON.stringify(optionType)}.toLowerCase();

        // Wait for CSRF token to appear (Angular may inject it after initial render)
        let csrf = '';
        for (let i = 0; i < 10; i++) {
          csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
          if (csrf) break;
          await new Promise(r => setTimeout(r, 500));
        }
        if (!csrf) return { error: 'no-csrf' };

        const headers = { 'X-CSRF-TOKEN': csrf };
        const fields = [
          'baseSymbol','strikePrice','expirationDate','optionType',
          'lastPrice','volume','openInterest','volumeOpenInterestRatio','volatility',
        ].join(',');

        // Fetch extra rows when filtering by type since server-side filter doesn't work
        const fetchLimit = typeFilter !== 'all' ? limit * 3 : limit;

        // Try unusual_activity first, fall back to mostActive (unusual_activity is
        // empty outside market hours)
        const lists = [
          'options.unusual_activity.stocks.us',
          'options.mostActive.us',
        ];

        for (const list of lists) {
          try {
            const url = '/proxies/core-api/v1/options/get?list=' + list
              + '&fields=' + fields
              + '&orderBy=volumeOpenInterestRatio&orderDir=desc'
              + '&raw=1&limit=' + fetchLimit;

            const resp = await fetch(url, { credentials: 'include', headers });
            if (!resp.ok) continue;
            const d = await resp.json();
            let items = d?.data || [];
            if (items.length === 0) continue;

            // Apply client-side type filter
            if (typeFilter !== 'all') {
              items = items.filter(i => {
                const t = ((i.raw || i).optionType || '').toLowerCase();
                return t === typeFilter;
              });
            }
            return items.slice(0, limit).map(i => {
              const r = i.raw || i;
              return {
                symbol: r.baseSymbol || r.symbol,
                type: r.optionType,
                strike: r.strikePrice,
                expiration: r.expirationDate,
                last: r.lastPrice,
                volume: r.volume,
                openInterest: r.openInterest,
                volOiRatio: r.volumeOpenInterestRatio,
                iv: r.volatility,
              };
            });
          } catch(e) {}
        }

        return [];
      })()
    `);
        if (!data)
            return [];
        if (data.error === 'no-csrf') {
            throw new Error('Could not extract CSRF token from barchart.com. Make sure you are logged in.');
        }
        if (!Array.isArray(data))
            return [];
        return data.slice(0, limit).map(r => ({
            symbol: r.symbol || '',
            type: r.type || '',
            strike: r.strike,
            expiration: r.expiration ?? null,
            last: r.last != null ? Number(Number(r.last).toFixed(2)) : null,
            volume: r.volume,
            openInterest: r.openInterest,
            volOiRatio: r.volOiRatio != null ? Number(Number(r.volOiRatio).toFixed(2)) : null,
            iv: r.iv != null ? Number(Number(r.iv).toFixed(2)) + '%' : null,
        }));
    },
});
