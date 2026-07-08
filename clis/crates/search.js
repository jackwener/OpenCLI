// crates search — search the crates.io registry by free-text query.
//
// Hits `https://crates.io/api/v1/crates?q=…&per_page=…`. Returns name (round-
// trips into `crates crate`), latest version, description, downloads, recent
// downloads, repository, last-update.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { CRATES_BASE, cratesFetch, requireBoundedInt, requireString } from './utils.js';

cli({
    site: 'crates',
    name: 'search',
    access: 'read',
    description: 'Search the public crates.io registry by keyword',
    domain: 'crates.io',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword (e.g. "serde", "async runtime")' },
        { name: 'limit', type: 'int', default: 20, help: 'Max results (1-100)' },
    ],
    columns: ['rank', 'name', 'latestVersion', 'description', 'downloads', 'recentDownloads', 'repository', 'updated', 'url'],
    func: async (args) => {
        const query = requireString(args.query, 'query');
        const limit = requireBoundedInt(args.limit, 20, 100);
        const url = `${CRATES_BASE}/api/v1/crates?q=${encodeURIComponent(query)}&per_page=${limit}`;
        const body = await cratesFetch(url, 'crates search');
        const list = Array.isArray(body?.crates) ? body.crates : [];
        if (!list.length) {
            throw new EmptyResultError('crates search', `No crates.io results matched "${query}".`);
        }
        return list.slice(0, limit).map((c, i) => ({
            rank: i + 1,
            name: String(c.name ?? c.id ?? ''),
            latestVersion: String(c.newest_version ?? c.max_stable_version ?? c.max_version ?? ''),
            description: String(c.description ?? '').trim(),
            downloads: c.downloads != null ? Number(c.downloads) : null,
            recentDownloads: c.recent_downloads != null ? Number(c.recent_downloads) : null,
            repository: String(c.repository ?? c.homepage ?? ''),
            updated: String(c.updated_at ?? '').slice(0, 10),
            url: c.name ? `https://crates.io/crates/${c.name}` : '',
        }));
    },
});
