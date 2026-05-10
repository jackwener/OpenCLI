// coingecko exchanges — top crypto exchanges by 24h BTC trading volume.
//
// Hits the public `/api/v3/exchanges` endpoint. Returns the columns most
// useful for an agent: trust score, 24h BTC volume, country, year founded,
// canonical URL.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

cli({
    site: 'coingecko',
    name: 'exchanges',
    access: 'read',
    description: 'Top crypto exchanges by 24h BTC trading volume',
    domain: 'api.coingecko.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of exchanges (1-250, CoinGecko per_page upper bound)' },
        { name: 'page', type: 'int', default: 1, help: 'Page number (1-based)' },
    ],
    columns: ['rank', 'id', 'name', 'trustScore', 'volume24hBtc', 'country', 'yearEstablished', 'url'],
    func: async (args) => {
        const limit = Number(args.limit ?? 20);
        if (!Number.isInteger(limit) || limit <= 0) {
            throw new ArgumentError('coingecko limit must be a positive integer');
        }
        if (limit > 250) {
            throw new ArgumentError('coingecko limit must be <= 250 (per_page upper bound)');
        }
        const page = Number(args.page ?? 1);
        if (!Number.isInteger(page) || page <= 0) {
            throw new ArgumentError('coingecko page must be a positive integer');
        }
        const url = new URL('https://api.coingecko.com/api/v3/exchanges');
        url.searchParams.set('per_page', String(limit));
        url.searchParams.set('page', String(page));
        let resp;
        try {
            resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        }
        catch (err) {
            throw new CommandExecutionError(`coingecko exchanges request failed: ${err?.message ?? err}`);
        }
        if (resp.status === 429) {
            throw new CommandExecutionError(
                'coingecko returned HTTP 429 (rate limited)',
                'Free tier allows ~30 calls/min. Wait and retry.',
            );
        }
        if (!resp.ok) {
            throw new CommandExecutionError(`coingecko exchanges returned HTTP ${resp.status}`);
        }
        let data;
        try {
            data = await resp.json();
        }
        catch (err) {
            throw new CommandExecutionError(`coingecko exchanges returned malformed JSON: ${err?.message ?? err}`);
        }
        if (!Array.isArray(data) || !data.length) {
            throw new EmptyResultError('coingecko exchanges', 'CoinGecko returned no exchange data.');
        }
        return data.map((ex, i) => ({
            rank: (page - 1) * limit + i + 1,
            id: String(ex.id ?? ''),
            name: String(ex.name ?? ''),
            trustScore: ex.trust_score != null ? Number(ex.trust_score) : null,
            volume24hBtc: ex.trade_volume_24h_btc != null ? Number(ex.trade_volume_24h_btc) : null,
            country: String(ex.country ?? ''),
            yearEstablished: ex.year_established != null ? Number(ex.year_established) : null,
            url: String(ex.url ?? ''),
        }));
    },
});
