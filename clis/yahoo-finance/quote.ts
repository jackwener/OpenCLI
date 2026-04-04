/**
 * Yahoo Finance stock quote — multi-strategy API fallback.
 */
import { cli, Strategy } from '../../registry.js';

cli({
  site: 'yahoo-finance',
  name: 'quote',
  description: 'Yahoo Finance 股票行情',
  domain: 'finance.yahoo.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'symbol', required: true, positional: true, help: 'Stock ticker (e.g. AAPL, MSFT, TSLA)' },
  ],
  columns: ['symbol', 'name', 'price', 'change', 'changePercent', 'open', 'high', 'low', 'volume', 'marketCap'],
  func: async (page, kwargs) => {
    const symbol = kwargs.symbol.toUpperCase().trim();
    await page.goto(`https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`);
    const data = await page.evaluate(`
      (async () => {
        const sym = '${symbol}';

        // Strategy 1: v8 chart API
        try {
          const chartUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(sym) + '?interval=1d&range=1d';
          const resp = await fetch(chartUrl);
          if (resp.ok) {
            const d = await resp.json();
            const chart = d?.chart?.result?.[0];
            if (chart) {
              const meta = chart.meta || {};
              const prevClose = meta.previousClose || meta.chartPreviousClose;
              const price = meta.regularMarketPrice;
              const change = price != null && prevClose != null ? (price - prevClose) : null;
              const changePct = change != null && prevClose ? ((change / prevClose) * 100) : null;
              return {
                symbol: meta.symbol || sym, name: meta.shortName || meta.longName || sym,
                price: price != null ? Number(price.toFixed(2)) : null,
                change: change != null ? change.toFixed(2) : null,
                changePercent: changePct != null ? changePct.toFixed(2) + '%' : null,
                open: chart.indicators?.quote?.[0]?.open?.[0] || null,
                high: meta.regularMarketDayHigh || null,
                low: meta.regularMarketDayLow || null,
                volume: meta.regularMarketVolume || null,
                marketCap: null, currency: meta.currency, exchange: meta.exchangeName,
              };
            }
          }
        } catch(e) {}

        // Strategy 2: Parse from page
        const titleEl = document.querySelector('title');
        const priceEl = document.querySelector('[data-testid="qsp-price"]');
        const changeEl = document.querySelector('[data-testid="qsp-price-change"]');
        const changePctEl = document.querySelector('[data-testid="qsp-price-change-percent"]');
        if (priceEl) {
          return {
            symbol: sym,
            name: titleEl ? titleEl.textContent.split('(')[0].trim() : sym,
            price: priceEl.textContent.replace(/,/g, ''),
            change: changeEl ? changeEl.textContent : null,
            changePercent: changePctEl ? changePctEl.textContent : null,
            open: null, high: null, low: null, volume: null, marketCap: null,
          };
        }
        return {error: 'Could not fetch quote for ' + sym};
      })()
    `);
    if (!data || data.error) return [];
    return [data];
  },
});
