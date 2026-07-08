// rubygems search — search the RubyGems.org public index.
//
// Hits `https://rubygems.org/api/v1/search.json?query=…&page=1`. Returns an
// agent-useful projection: gem name (round-trips into `rubygems gem`), latest
// version, lifetime downloads, license(s), author(s), short info, project URL.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { GEMS_BASE, gemsFetch, requireBoundedInt, requireString } from './utils.js';

cli({
    site: 'rubygems',
    name: 'search',
    access: 'read',
    description: 'Search RubyGems.org gems by keyword',
    domain: 'rubygems.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword (e.g. "rails", "redis")' },
        { name: 'limit', type: 'int', default: 30, help: 'Max gems (1-100, single RubyGems page)' },
    ],
    columns: ['rank', 'gem', 'version', 'downloads', 'license', 'authors', 'info', 'url'],
    func: async (args) => {
        const query = requireString(args.query, 'query');
        const limit = requireBoundedInt(args.limit, 30, 100);
        const url = `${GEMS_BASE}/search.json?query=${encodeURIComponent(query)}&page=1`;
        const body = await gemsFetch(url, 'rubygems search');
        const list = Array.isArray(body) ? body : [];
        if (!list.length) {
            throw new EmptyResultError('rubygems search', `No gems matched "${query}".`);
        }
        return list.slice(0, limit).map((g, i) => {
            const name = String(g.name ?? '').trim();
            const licenses = Array.isArray(g.licenses) ? g.licenses.filter(Boolean).join(', ') : '';
            return {
                rank: i + 1,
                gem: name,
                version: String(g.version ?? '').trim(),
                downloads: g.downloads != null ? Number(g.downloads) : null,
                license: licenses,
                authors: String(g.authors ?? '').trim(),
                info: String(g.info ?? '').trim(),
                url: name ? `https://rubygems.org/gems/${name}` : '',
            };
        });
    },
});
