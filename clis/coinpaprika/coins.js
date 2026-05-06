// coinpaprika coins — listing of all coins (id, name, symbol, rank, type).
//
// Endpoint: GET /coins (returns ~3k+ coins, ranked).
// No server-side limit param — client-side slice. The id column round-trips
// to `coinpaprika ticker <coin-id>`.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { cpFetch, requireBoundedInt, CP_BASE } from './utils.js';

cli({
    site: 'coinpaprika',
    name: 'coins',
    access: 'read',
    description: 'List Coinpaprika coins (ranked, with id for ticker round-trip)',
    domain: 'coinpaprika.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 50, help: 'Max rows (1-1000, default 50)' },
        { name: 'active', type: 'bool', default: false, help: 'Only include active (non-delisted) coins' },
    ],
    columns: [
        'rank', 'id', 'name', 'symbol', 'type', 'isNew', 'isActive', 'coinRank',
    ],
    func: async (args) => {
        const limit = requireBoundedInt(args.limit, 50, 1000);
        const url = `${CP_BASE}/coins`;
        const body = await cpFetch(url, 'coinpaprika coins');
        if (!Array.isArray(body) || body.length === 0) {
            throw new EmptyResultError('coinpaprika coins', 'coinpaprika.com returned no coins.');
        }
        // Coinpaprika's rank=0 means "not ranked" — sort those to the end.
        const sorted = body.slice().sort((a, b) => {
            const ar = a?.rank > 0 ? a.rank : Number.POSITIVE_INFINITY;
            const br = b?.rank > 0 ? b.rank : Number.POSITIVE_INFINITY;
            return ar - br;
        });
        const filtered = args.active
            ? sorted.filter((c) => c?.is_active === true)
            : sorted;
        if (!filtered.length) {
            throw new EmptyResultError('coinpaprika coins', 'No coins matched --active filter.');
        }
        return filtered.slice(0, limit).map((c, i) => ({
            rank: i + 1,
            id: c?.id ?? null,
            name: c?.name ?? null,
            symbol: c?.symbol ?? null,
            type: c?.type ?? null,
            isNew: c?.is_new ?? null,
            isActive: c?.is_active ?? null,
            coinRank: c?.rank > 0 ? c.rank : null, // null preserves "unranked" semantics vs 0
        }));
    },
});
