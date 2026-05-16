/**
 * Barchart options greeks overview — IV, delta, gamma, theta, vega, rho
 * for near-the-money options on a given symbol.
 * Auth: CSRF token from <meta name="csrf-token"> + session cookies.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const DEFAULT_LIMIT = 10;
const MIN_LIMIT = 1;
const MAX_LIMIT = 100;

function normalizeSymbol(value) {
    const symbol = String(value ?? '').trim().toUpperCase();
    if (!symbol) throw new ArgumentError('symbol is required');
    return symbol;
}

function normalizeExpiration(value) {
    const expiration = String(value ?? '').trim();
    if (!expiration) return '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiration)) {
        throw new ArgumentError('--expiration must use YYYY-MM-DD format');
    }
    const parsed = new Date(`${expiration}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== expiration) {
        throw new ArgumentError('--expiration must be a valid calendar date');
    }
    return expiration;
}

function parseLimit(value) {
    if (value === undefined || value === null || value === '') return DEFAULT_LIMIT;
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < MIN_LIMIT || limit > MAX_LIMIT) {
        throw new ArgumentError(`--limit must be an integer between ${MIN_LIMIT} and ${MAX_LIMIT}`);
    }
    return limit;
}

function unwrapBrowserResult(value) {
    if (value && typeof value === 'object' && 'session' in value && 'data' in value) {
        return value.data;
    }
    return value;
}

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
        { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: 'Number of near-the-money strikes per type (1-100)' },
    ],
    columns: [
        'type', 'strike', 'last', 'iv', 'delta', 'gamma', 'theta', 'vega', 'rho',
        'volume', 'openInterest', 'expiration',
    ],
    func: async (page, kwargs) => {
        const symbol = normalizeSymbol(kwargs.symbol);
        const expiration = normalizeExpiration(kwargs.expiration);
        const limit = parseLimit(kwargs.limit);
        await page.goto(`https://www.barchart.com/stocks/quotes/${encodeURIComponent(symbol)}/options`);
        await page.wait(4);
        const data = unwrapBrowserResult(await page.evaluate(`
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
          if (!resp.ok) {
            return { ok: false, reason: 'http', status: resp.status, statusText: resp.statusText || '' };
          }

          const d = await resp.json();
          const allItems = d?.data;
          if (!Array.isArray(allItems)) {
            return { ok: false, reason: 'malformed' };
          }
          let items = allItems;

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

          // Separate calls and puts, sort by distance from current price.
          const calls = items
            .filter(i => ((i.raw || i).optionType || '').toLowerCase() === 'call')
            .sort((a, b) => Math.abs((a.raw || a).percentFromLast || 999) - Math.abs((b.raw || b).percentFromLast || 999))
            .slice(0, limit);
          const puts = items
            .filter(i => ((i.raw || i).optionType || '').toLowerCase() === 'put')
            .sort((a, b) => Math.abs((a.raw || a).percentFromLast || 999) - Math.abs((b.raw || b).percentFromLast || 999))
            .slice(0, limit);
          const selected = [...calls, ...puts];

          if (items.length > 0 && selected.length === 0) {
            return { ok: false, reason: 'malformed', message: 'options rows did not include call or put identities' };
          }

          return {
            ok: true,
            rows: selected.map(i => {
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
            })
          };
        } catch(e) {
          return { ok: false, reason: 'exception', message: e?.message || String(e) };
        }
      })()
    `));
        if (!data || data.ok !== true) {
            if (data?.reason === 'http') {
                throw new CommandExecutionError(`Barchart greeks request failed: HTTP ${data.status}${data.statusText ? ` ${data.statusText}` : ''}`);
            }
            if (data?.reason === 'malformed') {
                throw new CommandExecutionError(`Barchart greeks returned an unreadable options payload${data.message ? `: ${data.message}` : ''}`);
            }
            if (data?.reason === 'exception') {
                throw new CommandExecutionError(`Barchart greeks request failed: ${data.message || 'unknown error'}`);
            }
            throw new CommandExecutionError(`Failed to fetch Barchart greeks for ${symbol}`);
        }
        if (!Array.isArray(data.rows)) {
            throw new CommandExecutionError('Barchart greeks returned an unreadable options payload');
        }
        if (data.rows.length === 0) {
            throw new EmptyResultError('barchart greeks', `No option greeks were returned for ${symbol}. Confirm the symbol, expiration, and Barchart login state.`);
        }
        return data.rows.map(r => {
            if (!r || typeof r !== 'object' || Array.isArray(r)) {
                throw new CommandExecutionError('Barchart greeks returned a malformed option row');
            }
            const type = String(r.type || '').trim();
            const expirationValue = String(r.expiration || '').trim();
            if (!/^(call|put)$/i.test(type) || r.strike === undefined || r.strike === null || r.strike === '' || !expirationValue) {
                throw new CommandExecutionError('Barchart greeks returned a malformed option row identity');
            }
            return {
                type,
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
                expiration: expirationValue,
            };
        });
    },
});

export const __test__ = {
    normalizeSymbol,
    normalizeExpiration,
    parseLimit,
    unwrapBrowserResult,
};
