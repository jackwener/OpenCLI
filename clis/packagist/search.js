// packagist search — search Packagist's PHP / Composer package registry.
//
// Hits `https://packagist.org/search.json?q=…&per_page=…`. Returns the
// agent-useful projection: vendor/package (round-trips into `packagist
// package`), description, lifetime download count, GitHub-stars-style favers,
// repository URL.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { PACKAGIST_BASE, packagistFetch, requireBoundedInt, requireString } from './utils.js';

cli({
    site: 'packagist',
    name: 'search',
    access: 'read',
    description: 'Search Packagist (PHP / Composer) packages by keyword',
    domain: 'packagist.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword (e.g. "symfony", "laravel http")' },
        { name: 'limit', type: 'int', default: 30, help: 'Max packages (1-100, single Packagist page)' },
    ],
    columns: ['rank', 'package', 'description', 'downloads', 'favers', 'repository', 'url'],
    func: async (args) => {
        const query = requireString(args.query, 'query');
        const limit = requireBoundedInt(args.limit, 30, 100);
        const url = `${PACKAGIST_BASE}/search.json?q=${encodeURIComponent(query)}&per_page=${limit}`;
        const body = await packagistFetch(url, 'packagist search');
        const list = Array.isArray(body?.results) ? body.results : [];
        if (!list.length) {
            throw new EmptyResultError('packagist search', `No Packagist packages matched "${query}".`);
        }
        return list.slice(0, limit).map((row, i) => ({
            rank: i + 1,
            package: String(row.name ?? '').trim(),
            description: String(row.description ?? '').trim(),
            downloads: row.downloads != null ? Number(row.downloads) : null,
            favers: row.favers != null ? Number(row.favers) : null,
            repository: String(row.repository ?? '').trim(),
            url: String(row.url ?? '').trim(),
        }));
    },
});
