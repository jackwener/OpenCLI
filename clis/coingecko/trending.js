// coingecko trending — top trending coins on CoinGecko (by user search activity).
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';

cli({
    site: 'coingecko',
    name: 'trending',
    access: 'read',
    description: 'Top trending cryptocurrencies on CoinGecko in the last 24h (search-volume based).',
    domain: 'api.coingecko.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [],
    columns: ['rank', 'id', 'symbol', 'name', 'marketCapRank', 'priceBtc', 'thumb'],
    func: async () => {
        const url = 'https://api.coingecko.com/api/v3/search/trending';
        let resp;
        try {
            resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        } catch (error) {
            throw new CommandExecutionError(`coingecko trending request failed: ${error?.message || error}`);
        }
        if (resp.status === 429) {
            throw new CommandExecutionError('coingecko returned HTTP 429 (rate limited)', 'Wait and retry.');
        }
        if (!resp.ok) {
            throw new CommandExecutionError(`coingecko trending failed: HTTP ${resp.status}`);
        }
        let data;
        try {
            data = await resp.json();
        } catch (error) {
            throw new CommandExecutionError(`coingecko returned malformed JSON: ${error?.message || error}`);
        }
        const coins = Array.isArray(data?.coins) ? data.coins : [];
        if (coins.length === 0) {
            throw new EmptyResultError('coingecko trending', 'coingecko returned no trending coins.');
        }
        return coins.map((entry, i) => {
            const c = entry?.item || {};
            return {
                rank: i + 1,
                id: c.id || '',
                symbol: String(c.symbol || '').toUpperCase(),
                name: c.name || '',
                marketCapRank: c.market_cap_rank ?? null,
                priceBtc: c.price_btc ?? null,
                thumb: c.thumb || c.small || c.large || '',
            };
        });
    },
});
