import { cli, Strategy } from '@jackwener/opencli/registry';
import { DOMAIN, SITE, gqlRequest } from './_helpers.js';
cli({
    site: SITE,
    name: 'tags',
    description: 'List popular tags',
    domain: DOMAIN,
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [{ name: 'limit', type: 'int', default: 20, help: 'Number of results' }],
    columns: ['rank', 'name', 'posts'],
    func: async (_page, kwargs) => {
        const limit = Number(kwargs.limit ?? 20);
        const query = `query Tags {
      tags(input: {terms: {view: "coreTags", limit: ${limit}}}) {
        results { _id name slug postCount }
      }
    }`;
        const data = await gqlRequest(query);
        const tags = (data?.tags?.results ?? []);
        return tags.map((item, i) => ({
            rank: i + 1,
            name: item.name ?? '',
            posts: item.postCount ?? 0,
        }));
    },
});
