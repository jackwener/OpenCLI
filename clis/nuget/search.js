// nuget search — full-text search the NuGet package index.
//
// Hits `azuresearch-usnc.nuget.org/query?q=…&take=…&prerelease=false`. The `id`
// column round-trips into `nuget package` for full version history.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    NUGET_SEARCH_BASE,
    joinAuthors,
    joinTags,
    nugetFetch,
    requireBoundedInt,
    requireString,
} from './utils.js';

cli({
    site: 'nuget',
    name: 'search',
    access: 'read',
    description: 'Search NuGet packages by keyword',
    domain: 'api.nuget.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword' },
        { name: 'limit', type: 'int', default: 20, help: 'Max packages (1-1000)' },
        { name: 'prerelease', type: 'boolean', default: false, help: 'Include prerelease versions' },
    ],
    columns: [
        'rank',
        'id',
        'version',
        'title',
        'description',
        'authors',
        'tags',
        'totalDownloads',
        'verified',
        'projectUrl',
        'url',
    ],
    func: async (args) => {
        const query = requireString(args.query, 'query');
        const limit = requireBoundedInt(args.limit, 20, 1000);
        const prerelease = args.prerelease === true ? 'true' : 'false';
        const url = `${NUGET_SEARCH_BASE}/query?q=${encodeURIComponent(query)}&take=${limit}&prerelease=${prerelease}`;
        const body = await nugetFetch(url, 'nuget search');
        const list = Array.isArray(body?.data) ? body.data : [];
        if (!list.length) {
            throw new EmptyResultError('nuget search', `No NuGet packages matched "${query}".`);
        }
        return list.slice(0, limit).map((pkg, i) => {
            const id = typeof pkg?.id === 'string' ? pkg.id : '';
            return {
                rank: i + 1,
                id,
                version: typeof pkg?.version === 'string' ? pkg.version : null,
                title: typeof pkg?.title === 'string' ? pkg.title : null,
                description: typeof pkg?.description === 'string' ? pkg.description : null,
                authors: joinAuthors(pkg?.authors),
                tags: joinTags(pkg?.tags),
                totalDownloads: typeof pkg?.totalDownloads === 'number' ? pkg.totalDownloads : null,
                verified: pkg?.verified === true,
                projectUrl: typeof pkg?.projectUrl === 'string' ? pkg.projectUrl : null,
                url: id ? `https://www.nuget.org/packages/${id}` : '',
            };
        });
    },
});
