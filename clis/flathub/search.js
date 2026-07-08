// flathub search — keyword search the Flathub app registry.
//
// POSTs to `/api/v2/search` with `{query}`. The `appId` column round-trips into
// `flathub app` for full appstream detail. Note: the search hit's `id` is
// underscored (e.g. `org_mozilla_firefox`); the actual reverse-DNS appId lives
// at `app_id`. We surface the dotted form so it round-trips without translation.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    FLATHUB_API_BASE,
    FLATHUB_APP_BASE,
    flathubFetch,
    joinList,
    requireBoundedInt,
    requireString,
} from './utils.js';

cli({
    site: 'flathub',
    name: 'search',
    access: 'read',
    description: 'Search Flathub apps by keyword',
    domain: 'flathub.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword' },
        { name: 'limit', type: 'int', default: 25, help: 'Max apps (1-100)' },
    ],
    columns: [
        'rank',
        'appId',
        'name',
        'summary',
        'developer',
        'license',
        'isFreeLicense',
        'mainCategories',
        'installsLastMonth',
        'updatedAt',
        'url',
    ],
    func: async (args) => {
        const query = requireString(args.query, 'query');
        const limit = requireBoundedInt(args.limit, 25, 100);
        const url = `${FLATHUB_API_BASE}/search`;
        const body = await flathubFetch(url, 'flathub search', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ query, hitsPerPage: limit, page: 1 }),
        });
        const list = Array.isArray(body?.hits) ? body.hits : [];
        if (!list.length) {
            throw new EmptyResultError('flathub search', `No Flathub apps matched "${query}".`);
        }
        return list.slice(0, limit).map((hit, i) => {
            const appId = typeof hit?.app_id === 'string' ? hit.app_id : null;
            return {
                rank: i + 1,
                appId,
                name: typeof hit?.name === 'string' ? hit.name : null,
                summary: typeof hit?.summary === 'string' ? hit.summary : null,
                developer: typeof hit?.developer_name === 'string' ? hit.developer_name : null,
                license: typeof hit?.project_license === 'string' ? hit.project_license : null,
                isFreeLicense: hit?.is_free_license === true,
                // `main_categories` comes back as a string (single value) on /search, not an array.
                mainCategories: typeof hit?.main_categories === 'string'
                    ? hit.main_categories
                    : joinList(hit?.main_categories),
                installsLastMonth: typeof hit?.installs_last_month === 'number' ? hit.installs_last_month : null,
                // /search emits `updated_at` as unix-seconds int; /appstream emits ISO strings.
                // Normalise to ISO date here so both surfaces look consistent.
                updatedAt: typeof hit?.updated_at === 'number' && hit.updated_at > 0
                    ? new Date(hit.updated_at * 1000).toISOString().slice(0, 10)
                    : (typeof hit?.updated_at === 'string' ? hit.updated_at : null),
                url: appId ? `${FLATHUB_APP_BASE}/${appId}` : '',
            };
        });
    },
});
