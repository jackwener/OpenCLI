// coinpaprika ticker — price + market cap + volume + supply for a single coin.
//
// Endpoint: GET /tickers/<coin-id> (e.g. btc-bitcoin, eth-ethereum).
// USD quotes only via this endpoint — for other quotes use ?quotes=BTC,EUR.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { cpFetch, requireNonEmpty, CP_BASE } from './utils.js';

cli({
    site: 'coinpaprika',
    name: 'ticker',
    access: 'read',
    description: 'Live price + market cap + supply for a single coin',
    domain: 'coinpaprika.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'coin', positional: true, required: true, help: 'Coinpaprika coin id (e.g. btc-bitcoin, eth-ethereum)' },
    ],
    columns: [
        'id', 'name', 'symbol', 'rank', 'priceUsd', 'volume24hUsd', 'marketCapUsd',
        'percentChange1h', 'percentChange24h', 'percentChange7d',
        'totalSupply', 'maxSupply', 'circulatingSupply',
        'firstDataAt', 'lastUpdated',
    ],
    func: async (args) => {
        const coin = requireNonEmpty(args.coin, 'coin').toLowerCase();
        const url = `${CP_BASE}/tickers/${encodeURIComponent(coin)}`;
        const body = await cpFetch(url, 'coinpaprika ticker');
        if (!body || typeof body !== 'object') {
            throw new EmptyResultError('coinpaprika ticker', `coinpaprika.com returned no ticker data for ${coin}.`);
        }
        const usd = body?.quotes?.USD ?? {};
        return [{
            id: body?.id ?? null,
            name: body?.name ?? null,
            symbol: body?.symbol ?? null,
            rank: body?.rank ?? null,
            priceUsd: usd?.price ?? null,
            volume24hUsd: usd?.volume_24h ?? null,
            marketCapUsd: usd?.market_cap ?? null,
            percentChange1h: usd?.percent_change_1h ?? null,
            percentChange24h: usd?.percent_change_24h ?? null,
            percentChange7d: usd?.percent_change_7d ?? null,
            totalSupply: body?.total_supply ?? null,
            maxSupply: body?.max_supply ?? null,
            circulatingSupply: body?.circulating_supply ?? null,
            firstDataAt: body?.first_data_at ?? null,
            lastUpdated: body?.last_updated ?? null,
        }];
    },
});
