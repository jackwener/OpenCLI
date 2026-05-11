// coingecko coin — fetch a single cryptocurrency's market detail by id.
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    CommandExecutionError,
    EmptyResultError,
} from '@jackwener/opencli/errors';

cli({
    site: 'coingecko',
    name: 'coin',
    access: 'read',
    description: 'Fetch a single cryptocurrency\'s market data by CoinGecko id (e.g. bitcoin, ethereum).',
    domain: 'api.coingecko.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, type: 'string', help: 'CoinGecko coin id (lowercase, e.g. bitcoin / ethereum / solana).' },
        { name: 'currency', type: 'string', default: 'usd', help: 'Quote currency (usd, cny, eur, jpy, ...).' },
    ],
    columns: [
        'id', 'symbol', 'name', 'rank', 'price', 'marketCap', 'volume24h',
        'change24hPct', 'change7dPct', 'change30dPct', 'ath', 'athDate', 'atl', 'atlDate',
        'circulatingSupply', 'totalSupply', 'maxSupply', 'genesisDate', 'homepage',
    ],
    func: async (args) => {
        const id = String(args.id ?? '').trim().toLowerCase();
        if (!id) {
            throw new ArgumentError('coingecko coin id cannot be empty', 'Example: opencli coingecko coin bitcoin');
        }
        if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
            throw new ArgumentError(`coingecko coin id must look like a CoinGecko slug (got "${args.id}")`);
        }
        const currency = String(args.currency ?? 'usd').trim().toLowerCase();
        if (!/^[a-z0-9-]{2,20}$/.test(currency)) {
            throw new ArgumentError(`coingecko currency must look like a currency slug (got "${args.currency}")`);
        }

        const url = new URL(`https://api.coingecko.com/api/v3/coins/${id}`);
        url.searchParams.set('localization', 'false');
        url.searchParams.set('tickers', 'false');
        url.searchParams.set('market_data', 'true');
        url.searchParams.set('community_data', 'false');
        url.searchParams.set('developer_data', 'false');
        url.searchParams.set('sparkline', 'false');

        let resp;
        try {
            resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        } catch (error) {
            throw new CommandExecutionError(`coingecko coin request failed: ${error?.message || error}`);
        }
        if (resp.status === 404) {
            throw new EmptyResultError('coingecko coin', `coingecko has no coin with id "${id}".`);
        }
        if (resp.status === 429) {
            throw new CommandExecutionError('coingecko returned HTTP 429 (rate limited)', 'Free tier allows ~30 calls/min. Wait and retry.');
        }
        if (!resp.ok) {
            throw new CommandExecutionError(`coingecko coin failed: HTTP ${resp.status}`);
        }
        let data;
        try {
            data = await resp.json();
        } catch (error) {
            throw new CommandExecutionError(`coingecko returned malformed JSON: ${error?.message || error}`);
        }
        if (data?.error) {
            throw new CommandExecutionError(`coingecko returned error: ${data.error}`);
        }

        const md = data.market_data || {};
        const pick = (obj, key) => (obj && obj[key] != null ? obj[key] : null);
        const isoFromMaybe = (s) => (s ? String(s).slice(0, 10) : '');
        const price = pick(md.current_price, currency);
        const marketCap = pick(md.market_cap, currency);
        const volume24h = pick(md.total_volume, currency);
        if (price == null && marketCap == null && volume24h == null) {
            throw new CommandExecutionError(
                `coingecko returned no market data for currency "${currency}"`,
                'Use a CoinGecko-supported quote currency such as usd, cny, eur, or jpy.',
            );
        }

        return [{
            id: data.id || id,
            symbol: String(data.symbol || '').toUpperCase(),
            name: data.name || '',
            rank: data.market_cap_rank ?? null,
            price,
            marketCap,
            volume24h,
            change24hPct: md.price_change_percentage_24h ?? null,
            change7dPct: md.price_change_percentage_7d ?? null,
            change30dPct: md.price_change_percentage_30d ?? null,
            ath: pick(md.ath, currency),
            athDate: isoFromMaybe(pick(md.ath_date, currency)),
            atl: pick(md.atl, currency),
            atlDate: isoFromMaybe(pick(md.atl_date, currency)),
            circulatingSupply: md.circulating_supply ?? null,
            totalSupply: md.total_supply ?? null,
            maxSupply: md.max_supply ?? null,
            genesisDate: data.genesis_date || '',
            homepage: Array.isArray(data.links?.homepage) ? (data.links.homepage.find(Boolean) || '') : '',
        }];
    },
});
