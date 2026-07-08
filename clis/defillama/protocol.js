// defillama protocol — single DeFi protocol details by slug.
//
// Hits `https://api.llama.fi/protocol/<slug>`. The endpoint returns a rich
// object that includes a `tvl` time-series array; we project the latest entry
// as the current TVL plus identifying metadata (category from /protocols since
// the per-protocol endpoint omits it).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { LLAMA_BASE, llamaFetch, requireSlug, unixToDate } from './utils.js';

cli({
    site: 'defillama',
    name: 'protocol',
    access: 'read',
    description: 'Single DefiLlama protocol details (current TVL, mcap, chains, twitter, github, description)',
    domain: 'defillama.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'slug', positional: true, type: 'string', required: true, help: 'DefiLlama protocol slug (e.g. "aave", "lido")' },
    ],
    columns: [
        'slug', 'name', 'category', 'isParent', 'tvl', 'tvlAt', 'mcap',
        'chains', 'twitter', 'github', 'audits', 'listedAt',
        'description', 'website', 'url',
    ],
    func: async (args) => {
        const slug = requireSlug(args.slug, 'slug');
        // Per-protocol detail endpoint
        const detail = await llamaFetch(`${LLAMA_BASE}/protocol/${encodeURIComponent(slug)}`, `defillama protocol ${slug}`);
        if (!detail || !detail.name) {
            throw new EmptyResultError('defillama protocol', `DefiLlama returned no metadata for "${slug}".`);
        }
        // Latest TVL from the time-series array (per-protocol endpoint omits a scalar tvl).
        const tvlSeries = Array.isArray(detail.tvl) ? detail.tvl : [];
        const lastPoint = tvlSeries.length ? tvlSeries[tvlSeries.length - 1] : null;
        const tvl = lastPoint && Number.isFinite(Number(lastPoint.totalLiquidityUSD))
            ? Number(lastPoint.totalLiquidityUSD)
            : null;
        const tvlAt = lastPoint ? unixToDate(lastPoint.date) : null;
        // /protocols carries category + chains. Parent protocols (isParentProtocol=true)
        // do NOT appear in /protocols themselves — only their children do — so we union
        // child chains and leave category empty for parents.
        const isParent = detail.isParentProtocol === true;
        let category = '';
        const chainsSet = new Set(Array.isArray(detail.chains) ? detail.chains : []);
        const list = await llamaFetch(`${LLAMA_BASE}/protocols`, `defillama protocol ${slug} list lookup`);
        if (Array.isArray(list)) {
            if (!isParent) {
                const match = list.find((p) => p && p.slug === slug);
                if (match && typeof match.category === 'string') category = match.category;
                if (match && Array.isArray(match.chains)) {
                    for (const c of match.chains) chainsSet.add(c);
                }
            }
            else {
                // Aggregate chains across child protocols of this parent.
                for (const p of list) {
                    if (p && p.parentProtocol === detail.id && Array.isArray(p.chains)) {
                        for (const c of p.chains) chainsSet.add(c);
                    }
                }
            }
        }
        const githubArr = Array.isArray(detail.github) ? detail.github : [];
        return [{
            slug,
            name: String(detail.name).trim(),
            category,
            isParent,
            tvl,
            tvlAt,
            mcap: detail.mcap == null ? null : Number(detail.mcap),
            chains: [...chainsSet].join(', '),
            twitter: String(detail.twitter ?? '').trim(),
            github: githubArr.join(', '),
            audits: String(detail.audits ?? '').trim(),
            listedAt: unixToDate(detail.listedAt),
            description: String(detail.description ?? '').trim(),
            website: String(detail.url ?? '').trim(),
            url: `https://defillama.com/protocol/${slug}`,
        }];
    },
});
