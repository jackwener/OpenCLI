// defillama protocols — top DeFi protocols by current TVL.
//
// Hits `https://api.llama.fi/protocols`, sorts by TVL (desc), and returns the
// requested top-N. The API ships ~7400 entries today; we cap output at 500
// rows so agents do not paginate their entire DeFi universe by accident.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { LLAMA_BASE, llamaFetch, requireBoundedInt, unixToDate } from './utils.js';

cli({
    site: 'defillama',
    name: 'protocols',
    access: 'read',
    description: 'Top DeFi protocols on DefiLlama by current TVL (slug, name, category, TVL, mcap, change_1d/7d, chains)',
    domain: 'defillama.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 30, help: 'Number of rows to return (1-500)' },
    ],
    columns: [
        'rank', 'slug', 'name', 'category', 'tvl', 'mcap',
        'change_1d', 'change_7d', 'chains', 'listedAt', 'url',
    ],
    func: async (args) => {
        const limit = requireBoundedInt(args.limit, 30, 500, 'limit');
        const list = await llamaFetch(`${LLAMA_BASE}/protocols`, 'defillama protocols');
        if (!Array.isArray(list) || list.length === 0) {
            throw new EmptyResultError('defillama protocols', 'DefiLlama returned no protocol entries.');
        }
        const ranked = list
            .filter((p) => p && (p.slug || p.name) && Number.isFinite(Number(p.tvl)))
            .sort((a, b) => Number(b.tvl) - Number(a.tvl))
            .slice(0, limit);
        if (ranked.length === 0) {
            throw new EmptyResultError('defillama protocols', 'DefiLlama returned no protocols with numeric TVL.');
        }
        return ranked.map((p, i) => {
            const slug = String(p.slug ?? '').trim();
            return {
                rank: i + 1,
                slug,
                name: String(p.name ?? '').trim(),
                category: String(p.category ?? '').trim(),
                tvl: Number(p.tvl),
                mcap: p.mcap == null ? null : Number(p.mcap),
                change_1d: p.change_1d == null ? null : Number(p.change_1d),
                change_7d: p.change_7d == null ? null : Number(p.change_7d),
                chains: Array.isArray(p.chains) ? p.chains.join(', ') : '',
                listedAt: unixToDate(p.listedAt),
                url: slug ? `https://defillama.com/protocol/${slug}` : '',
            };
        });
    },
});
