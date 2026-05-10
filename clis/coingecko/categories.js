// coingecko categories — top crypto categories by aggregated market cap.
//
// Hits the public `/api/v3/coins/categories` endpoint. Useful for spotting
// which sectors (DeFi, L1, gaming, RWAs, …) are leading the market.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const ORDER_OPTIONS = ['market_cap_desc', 'market_cap_asc', 'name_desc', 'name_asc', 'market_cap_change_24h_desc', 'market_cap_change_24h_asc'];

cli({
    site: 'coingecko',
    name: 'categories',
    access: 'read',
    description: 'Crypto categories ranked by aggregated market cap',
    domain: 'api.coingecko.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'sort', default: 'market_cap_desc', help: `Sort order (${ORDER_OPTIONS.join(' / ')})` },
        { name: 'limit', type: 'int', default: 20, help: 'Number of categories (1-100; CoinGecko returns ~120 max)' },
    ],
    columns: ['rank', 'id', 'name', 'marketCap', 'volume24h', 'marketCapChange24hPct', 'top3Coins'],
    func: async (args) => {
        const sort = String(args.sort ?? 'market_cap_desc').trim().toLowerCase();
        if (!ORDER_OPTIONS.includes(sort)) {
            throw new ArgumentError(
                `coingecko sort "${args.sort}" is not supported`,
                `Supported sorts: ${ORDER_OPTIONS.join(', ')}`,
            );
        }
        const limit = Number(args.limit ?? 20);
        if (!Number.isInteger(limit) || limit <= 0) {
            throw new ArgumentError('coingecko limit must be a positive integer');
        }
        if (limit > 100) {
            throw new ArgumentError('coingecko limit must be <= 100');
        }
        const url = `https://api.coingecko.com/api/v3/coins/categories?order=${encodeURIComponent(sort)}`;
        let resp;
        try {
            resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        }
        catch (err) {
            throw new CommandExecutionError(`coingecko categories request failed: ${err?.message ?? err}`);
        }
        if (resp.status === 429) {
            throw new CommandExecutionError(
                'coingecko returned HTTP 429 (rate limited)',
                'Free tier allows ~30 calls/min. Wait and retry.',
            );
        }
        if (!resp.ok) {
            throw new CommandExecutionError(`coingecko categories returned HTTP ${resp.status}`);
        }
        let data;
        try {
            data = await resp.json();
        }
        catch (err) {
            throw new CommandExecutionError(`coingecko categories returned malformed JSON: ${err?.message ?? err}`);
        }
        if (!Array.isArray(data) || !data.length) {
            throw new EmptyResultError('coingecko categories', 'CoinGecko returned no category data.');
        }
        return data.slice(0, limit).map((cat, i) => ({
            rank: i + 1,
            id: String(cat.id ?? ''),
            name: String(cat.name ?? ''),
            marketCap: cat.market_cap != null ? Number(cat.market_cap) : null,
            volume24h: cat.volume_24h != null ? Number(cat.volume_24h) : null,
            marketCapChange24hPct: cat.market_cap_change_24h != null ? Number(cat.market_cap_change_24h) : null,
            top3Coins: Array.isArray(cat.top_3_coins_id) ? cat.top_3_coins_id.join(', ') : '',
        }));
    },
});
