// npm search — search the public npm registry by free-text query.
//
// Hits `https://registry.npmjs.org/-/v1/search?text=…`. Returns enough per-row
// to feed back into `npm package` / `npm downloads`: name (round-trips as id),
// description, version, weekly downloads, dependents count, license, links.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { NPM_REGISTRY, npmFetch, requireBoundedInt, requireString } from './utils.js';

cli({
    site: 'npm',
    name: 'search',
    access: 'read',
    description: 'Search the public npm registry by keyword',
    domain: 'registry.npmjs.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword (e.g. "react", "graphql client")' },
        { name: 'limit', type: 'int', default: 20, help: 'Max results (1-250)' },
    ],
    columns: ['rank', 'name', 'version', 'description', 'weeklyDownloads', 'dependents', 'license', 'publisher', 'updated', 'url'],
    func: async (args) => {
        const query = requireString(args.query, 'query');
        const limit = requireBoundedInt(args.limit, 20, 250);
        const url = `${NPM_REGISTRY}/-/v1/search?text=${encodeURIComponent(query)}&size=${limit}`;
        const body = await npmFetch(url, 'npm search');
        const objects = Array.isArray(body?.objects) ? body.objects : [];
        if (!objects.length) {
            throw new EmptyResultError('npm search', `No npm packages matched "${query}".`);
        }
        return objects.slice(0, limit).map((obj, i) => {
            const pkg = obj?.package ?? {};
            const dl = obj?.downloads ?? {};
            return {
                rank: i + 1,
                name: String(pkg.name ?? ''),
                version: String(pkg.version ?? ''),
                description: String(pkg.description ?? ''),
                weeklyDownloads: dl.weekly != null ? Number(dl.weekly) : null,
                dependents: obj.dependents != null ? Number(obj.dependents) : null,
                license: String(pkg.license ?? ''),
                publisher: String(pkg.publisher?.username ?? ''),
                updated: String(obj.updated ?? '').slice(0, 10),
                url: pkg.links?.npm ? String(pkg.links.npm) : (pkg.name ? `https://www.npmjs.com/package/${pkg.name}` : ''),
            };
        });
    },
});
