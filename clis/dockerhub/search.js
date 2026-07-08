// dockerhub search — search the public Docker Hub repository index.
//
// Hits `https://hub.docker.com/v2/search/repositories/?query=…`. Returns the
// agent-useful projection: official-flag, owner/name (round-trips into
// `dockerhub image`), star count, pull count, short description.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { HUB_BASE, hubFetch, requireBoundedInt, requireString } from './utils.js';

cli({
    site: 'dockerhub',
    name: 'search',
    access: 'read',
    description: 'Search Docker Hub repositories by keyword',
    domain: 'hub.docker.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword (e.g. "nginx", "bitnami redis")' },
        { name: 'limit', type: 'int', default: 25, help: 'Max repositories (1-100, single Docker Hub page)' },
    ],
    columns: ['rank', 'image', 'official', 'stars', 'pulls', 'description', 'url'],
    func: async (args) => {
        const query = requireString(args.query, 'query');
        const limit = requireBoundedInt(args.limit, 25, 100);
        const url = `${HUB_BASE}/search/repositories/?query=${encodeURIComponent(query)}&page_size=${limit}`;
        const body = await hubFetch(url, 'dockerhub search');
        const list = Array.isArray(body?.results) ? body.results : [];
        if (!list.length) {
            throw new EmptyResultError('dockerhub search', `No Docker Hub repositories matched "${query}".`);
        }
        return list.slice(0, limit).map((r, i) => {
            const owner = String(r.repo_owner ?? '').trim();
            const name = String(r.repo_name ?? '').trim();
            const image = owner ? `${owner}/${name}` : (r.is_official ? `library/${name}` : name);
            return {
                rank: i + 1,
                image,
                official: Boolean(r.is_official),
                stars: r.star_count != null ? Number(r.star_count) : null,
                pulls: r.pull_count != null ? Number(r.pull_count) : null,
                description: String(r.short_description ?? '').trim(),
                url: image ? `https://hub.docker.com/r/${image}` : '',
            };
        });
    },
});
