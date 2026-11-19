// ohpm search — search the OpenHarmony OHPM third-party package registry.
//
// Hits the public `oh-package/openapi/v1/search` endpoint used by
// https://ohpm.openharmony.cn/ and returns package rows that round-trip into
// `ohpm package`.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    OHPM_API,
    dateFromMs,
    normalizeText,
    ohpmFetch,
    packageUrl,
    requireBoundedInt,
    requireSort,
    requireString,
} from './utils.js';

cli({
    site: 'ohpm',
    name: 'search',
    access: 'read',
    description: 'Search OpenHarmony OHPM third-party packages by keyword',
    domain: 'ohpm.openharmony.cn',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Package keyword (e.g. "axios", "json")' },
        { name: 'limit', type: 'int', default: 20, help: 'Max results (1-50)' },
        { name: 'sort', type: 'string', default: 'relevancy', help: 'Sort: relevancy, likes, latest' },
    ],
    columns: [
        'rank', 'name', 'latestVersion', 'description', 'license', 'keywords',
        'likes', 'points', 'popularity', 'publisher', 'org', 'published', 'url',
    ],
    func: async (args) => {
        const query = requireString(args.query, 'query');
        const limit = requireBoundedInt(args.limit, 20, 50);
        const sort = requireSort(args.sort);
        const params = new URLSearchParams({
            condition: query,
            pageNum: '1',
            pageSize: String(limit),
            sortedType: sort,
            isHomePage: 'false',
        });
        const body = await ohpmFetch(`${OHPM_API}/v1/search?${params}`, 'ohpm search');
        const rows = Array.isArray(body?.body?.rows) ? body.body.rows : [];
        if (!rows.length) {
            throw new EmptyResultError('ohpm search', `No OHPM packages matched "${query}".`);
        }
        return rows.slice(0, limit).map((item, i) => {
            const name = normalizeText(item.name);
            return {
                rank: i + 1,
                name,
                latestVersion: normalizeText(item.latestVersion),
                description: normalizeText(item.description),
                license: normalizeText(item.license),
                keywords: Array.isArray(item.keywords) ? item.keywords.join(', ') : '',
                likes: item.likes != null ? Number(item.likes) : null,
                points: item.points != null ? Number(item.points) : null,
                popularity: item.popularity != null ? Number(item.popularity) : null,
                publisher: normalizeText(item.publisherName || item.authorName),
                org: normalizeText(item.org),
                published: dateFromMs(item.latestPublishTime),
                url: name ? packageUrl(name) : '',
            };
        });
    },
});
