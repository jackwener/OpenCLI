/**
 * Barchart stock quote — price, volume, market cap, P/E, EPS, and key metrics.
 * Auth: CSRF token from <meta name="csrf-token"> + session cookies.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';

cli({
  site: 'barchart',
  name: 'quote',
  description: 'Barchart stock quote with price, volume, and key metrics',
  domain: 'www.barchart.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'symbol', required: true, positional: true, help: 'Stock ticker (e.g. AAPL, MSFT, TSLA)' },
  ],
  columns: [
    'symbol', 'name', 'price', 'change', 'changePct',
    'open', 'high', 'low', 'prevClose', 'volume',
    'avgVolume', 'marketCap', 'peRatio', 'eps',
  ],
  func: async (page, kwargs) => {
    const symbol = kwargs.symbol.toUpperCase().trim();
    await page.goto(`https://www.barchart.com/stocks/quotes/${encodeURIComponent(symbol)}/overview`);
    await page.wait(4);

    const data = await page.evaluate(`
      (async () => {
        const sym = '${symbol}';
        const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';

        // Strategy 1: internal proxy API with CSRF token
        try {
          const fields = [
            'symbol','symbolName','lastPrice','priceChange','percentChange',
            'highPrice','lowPrice','openPrice','previousPrice','volume','averageVolume',
            'marketCap','peRatio','earningsPerShare','tradeTime',
          ].join(',');
          const url = '/proxies/core-api/v1/quotes/get?symbol=' + encodeURIComponent(sym) + '&fields=' + fields;
          const resp = await fetch(url, {
            credentials: 'include',
            headers: { 'X-CSRF-TOKEN': csrf },
          });
          if (resp.ok) {
            const d = await resp.json();
            const row = d?.data?.[0] || null;
            if (row) {
              return { source: 'api', row };
            }
          }
        } catch(e) {}

        // Strategy 2: parse from DOM
        try {
          const priceEl = document.querySelector('span.last-change');
          const price = priceEl ? priceEl.textContent.trim() : null;

          // Change values are sibling spans inside .pricechangerow > .last-change
          const changeParent = priceEl?.parentElement;
          const changeSpans = changeParent ? changeParent.querySelectorAll('span') : [];
          let change = null;
          let changePct = null;
          for (const s of changeSpans) {
            const t = s.textContent.trim();
            if (s === priceEl) continue;
            if (t.includes('%')) changePct = t.replace(/[()]/g, '');
            else if (t.match(/^[+-]?[\\d.]+$/)) change = t;
          }

          // Financial data rows
          const rows = document.querySelectorAll('.financial-data-row');
          const fdata = {};
          for (const row of rows) {
            const spans = row.querySelectorAll('span');
            if (spans.length >= 2) {
              const label = spans[0].textContent.trim();
              const valSpan = row.querySelector('span.right span:not(.ng-hide)');
              fdata[label] = valSpan ? valSpan.textContent.trim() : '';
            }
          }

          // Day high/low from row chart
          const dayLow = document.querySelector('.bc-quote-row-chart .small-6:first-child .inline:not(.ng-hide)');
          const dayHigh = document.querySelector('.bc-quote-row-chart .text-right .inline:not(.ng-hide)');
          const openEl = document.querySelector('.mark span');
          const openText = openEl ? openEl.textContent.trim().replace('Open ', '') : null;

          const name = document.querySelector('h1 span.symbol');

          return {
            source: 'dom',
            row: {
              symbol: sym,
              symbolName: name ? name.textContent.trim() : sym,
              lastPrice: price,
              priceChange: change,
              percentChange: changePct,
              open: openText,
              highPrice: dayHigh ? dayHigh.textContent.trim() : null,
              lowPrice: dayLow ? dayLow.textContent.trim() : null,
              previousClose: fdata['Previous Close'] || null,
              volume: fdata['Volume'] || null,
              averageVolume: fdata['Average Volume'] || null,
              marketCap: null,
              peRatio: null,
              earningsPerShare: null,
            }
          };
        } catch(e) {
          return { error: 'Could not fetch quote for ' + sym + ': ' + e.message };
        }
      })()
    `);

    if (!data || data.error) throw new CommandExecutionError(data?.error || 'Failed to fetch quote');

    const r = data.row || {};
    // API returns formatted strings like "+1.41" and "+0.56%"; use raw if available
    const raw = r.raw || {};

    return [{
      symbol: r.symbol || symbol,
      name: r.symbolName || r.name || symbol,
      price: r.lastPrice ?? null,
      change: r.priceChange ?? null,
      changePct: r.percentChange ?? null,
      open: r.openPrice ?? r.open ?? null,
      high: r.highPrice ?? null,
      low: r.lowPrice ?? null,
      prevClose: r.previousPrice ?? r.previousClose ?? null,
      volume: r.volume ?? null,
      avgVolume: r.averageVolume ?? null,
      marketCap: r.marketCap ?? null,
      peRatio: r.peRatio ?? null,
      eps: r.earningsPerShare ?? null,
    }];
  },
});
