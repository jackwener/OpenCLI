import { cli, Strategy } from '@jackwener/opencli/registry';
import { atlassianRequest, parseLimit, requireString } from '../atlassian/shared.js';
import { confluenceConfig, normalizeSearchResult, withSpaceCql } from './shared.js';

cli({
    site: 'confluence',
    name: 'search',
    access: 'read',
    description: 'Search Confluence content with CQL',
    domain: 'atlassian.net',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'cql', positional: true, required: true, help: 'CQL query, e.g. "type = page and title ~ \\"RCA\\""' },
        { name: 'space', type: 'string', help: 'Limit search to a Confluence space key' },
        { name: 'limit', type: 'int', default: 20, help: 'Max results to return (1-100)' },
    ],
    columns: ['id', 'title', 'type', 'spaceKey', 'status', 'lastModified', 'url'],
    func: async (args) => {
        const config = confluenceConfig();
        const cql = withSpaceCql(requireString(args.cql, 'CQL'), args.space);
        const limit = parseLimit(args.limit, 20, 100, 'confluence limit');
        const path = `/rest/api/search?${new URLSearchParams({ cql, limit: String(limit) }).toString()}`;
        const data = await atlassianRequest(config, path, { label: 'confluence search' });
        const results = Array.isArray(data?.results) ? data.results : [];
        return results.map((result) => normalizeSearchResult(result, config));
    },
});
