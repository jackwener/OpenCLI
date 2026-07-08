// coingecko global — total crypto market cap, volume, BTC/ETH dominance,
// active currencies, ICO counts, in a single row.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

cli({
    site: 'coingecko',
    name: 'global',
    access: 'read',
    description: 'Aggregate crypto market stats: total market cap, volume, dominance',
    domain: 'api.coingecko.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'currency', type: 'string', default: 'usd', help: 'Quote currency for total market cap / volume (usd, cny, eur, jpy, ...)' },
    ],
    columns: ['currency', 'totalMarketCap', 'totalVolume24h', 'marketCapChange24hPct', 'btcDominancePct', 'ethDominancePct', 'activeCryptocurrencies', 'markets', 'ongoingIcos', 'updatedAt'],
    func: async (args) => {
        const currency = String(args.currency ?? 'usd').trim().toLowerCase();
        if (!/^[a-z0-9-]{2,20}$/.test(currency)) {
            throw new ArgumentError(`coingecko currency must look like a currency slug (got "${args.currency}")`);
        }
        let resp;
        try {
            resp = await fetch('https://api.coingecko.com/api/v3/global', { headers: { 'User-Agent': 'Mozilla/5.0' } });
        }
        catch (err) {
            throw new CommandExecutionError(`coingecko global request failed: ${err?.message ?? err}`);
        }
        if (resp.status === 429) {
            throw new CommandExecutionError(
                'coingecko returned HTTP 429 (rate limited)',
                'Free tier allows ~30 calls/min. Wait and retry.',
            );
        }
        if (!resp.ok) {
            throw new CommandExecutionError(`coingecko global returned HTTP ${resp.status}`);
        }
        let body;
        try {
            body = await resp.json();
        }
        catch (err) {
            throw new CommandExecutionError(`coingecko global returned malformed JSON: ${err?.message ?? err}`);
        }
        const data = body?.data;
        if (!data) {
            throw new CommandExecutionError('coingecko global returned no data envelope');
        }
        const totalMarketCap = data?.total_market_cap?.[currency];
        const totalVolume = data?.total_volume?.[currency];
        if (totalMarketCap == null && totalVolume == null) {
            throw new ArgumentError(
                `coingecko has no market totals for currency "${currency}"`,
                'Use a CoinGecko-supported quote currency such as usd, cny, eur, or jpy.',
            );
        }
        return [{
            currency: currency.toUpperCase(),
            totalMarketCap: totalMarketCap != null ? Number(totalMarketCap) : null,
            totalVolume24h: totalVolume != null ? Number(totalVolume) : null,
            marketCapChange24hPct: data.market_cap_change_percentage_24h_usd != null ? Number(data.market_cap_change_percentage_24h_usd) : null,
            btcDominancePct: data?.market_cap_percentage?.btc != null ? Number(data.market_cap_percentage.btc) : null,
            ethDominancePct: data?.market_cap_percentage?.eth != null ? Number(data.market_cap_percentage.eth) : null,
            activeCryptocurrencies: data.active_cryptocurrencies != null ? Number(data.active_cryptocurrencies) : null,
            markets: data.markets != null ? Number(data.markets) : null,
            ongoingIcos: data.ongoing_icos != null ? Number(data.ongoing_icos) : null,
            updatedAt: data.updated_at ? new Date(data.updated_at * 1000).toISOString() : '',
        }];
    },
});
