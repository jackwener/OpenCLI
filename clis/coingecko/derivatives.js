// coingecko derivatives — perpetual / futures tickers across crypto exchanges.
//
// Hits the public `/api/v3/derivatives` endpoint (no auth, free tier). Each
// row is one exchange-symbol combo: market, contract type, mark price, 24h
// %, basis vs index, funding rate, open interest (USD), 24h volume.
//
// CoinGecko sorts the response by 24h volume desc, so `rank` mirrors the
// listing order with no client-side reshuffling.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const ENDPOINT = 'https://api.coingecko.com/api/v3/derivatives';

cli({
    site: 'coingecko',
    name: 'derivatives',
    access: 'read',
    description: 'Top crypto derivative (perpetual / futures) markets by 24h volume',
    domain: 'api.coingecko.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Max rows to return (1-500; CoinGecko returns one large page).' },
        { name: 'symbol', type: 'string', required: false, help: 'Optional symbol substring filter (e.g. "BTC", "ETHUSDT").' },
    ],
    columns: ['rank', 'market', 'symbol', 'indexId', 'contractType', 'price', 'change24hPct', 'fundingRate', 'openInterestUsd', 'volume24hUsd', 'expired'],
    func: async (args) => {
        const limit = Number(args.limit ?? 20);
        if (!Number.isInteger(limit) || limit <= 0) {
            throw new ArgumentError('coingecko derivatives limit must be a positive integer');
        }
        if (limit > 500) {
            throw new ArgumentError('coingecko derivatives limit must be <= 500');
        }
        const filter = args.symbol == null ? '' : String(args.symbol).trim().toUpperCase();
        let resp;
        try {
            resp = await fetch(ENDPOINT, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        }
        catch (err) {
            throw new CommandExecutionError(`coingecko derivatives request failed: ${err?.message ?? err}`);
        }
        if (resp.status === 429) {
            throw new CommandExecutionError(
                'coingecko derivatives returned HTTP 429 (rate limited)',
                'Free tier allows ~30 calls/min. Wait and retry.',
            );
        }
        if (!resp.ok) {
            throw new CommandExecutionError(`coingecko derivatives returned HTTP ${resp.status}`);
        }
        let data;
        try {
            data = await resp.json();
        }
        catch (err) {
            throw new CommandExecutionError(`coingecko derivatives returned malformed JSON: ${err?.message ?? err}`);
        }
        if (!Array.isArray(data) || !data.length) {
            throw new EmptyResultError('coingecko derivatives', 'CoinGecko returned no derivative tickers.');
        }
        let rows = data;
        if (filter) {
            rows = data.filter((d) => String(d.symbol ?? '').toUpperCase().includes(filter)
                || String(d.index_id ?? '').toUpperCase().includes(filter));
            if (!rows.length) {
                throw new EmptyResultError('coingecko derivatives', `No derivative tickers matched symbol="${filter}".`);
            }
        }
        return rows.slice(0, limit).map((d, i) => ({
            rank: i + 1,
            market: String(d.market ?? ''),
            symbol: String(d.symbol ?? ''),
            indexId: String(d.index_id ?? ''),
            contractType: String(d.contract_type ?? ''),
            price: d.price != null ? Number(d.price) : null,
            change24hPct: d.price_percentage_change_24h != null ? Number(d.price_percentage_change_24h) : null,
            fundingRate: d.funding_rate != null ? Number(d.funding_rate) : null,
            openInterestUsd: d.open_interest != null ? Number(d.open_interest) : null,
            volume24hUsd: d.volume_24h != null ? Number(d.volume_24h) : null,
            expired: d.expired_at ? String(d.expired_at) : '',
        }));
    },
});
