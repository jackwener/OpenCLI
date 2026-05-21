import { cli, Strategy } from '@jackwener/opencli/registry';
import { atlassianRequest, parseLimit, queryString, requireNonEmptyRows, requireString } from '../_atlassian/shared.js';
import { confluenceConfig, confluenceResults, normalizeSearchResult, withSpaceCql } from './shared.js';

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
        // CQL search is still exposed through Confluence REST v1 for Cloud;
        // page CRUD uses v2 where available.
        const path = `/rest/api/search${queryString({ cql, limit })}`;
        const data = await atlassianRequest(config, path, { label: 'confluence search' });
        const results = confluenceResults(data, 'confluence search');
        return requireNonEmptyRows(
            results.map((result) => normalizeSearchResult(result, config)),
            'confluence search',
            `No Confluence content matched "${cql}".`,
        );
    },
});
