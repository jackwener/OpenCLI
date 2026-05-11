import { cli, Strategy } from '@jackwener/opencli/registry';
import { DOMAIN, SITE, gqlRequest } from './_helpers.js';
cli({
    site: SITE,
    name: 'sequences',
    access: 'read',
    description: 'List post collections',
    domain: DOMAIN,
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [{ name: 'limit', type: 'int', default: 10, help: 'Number of results' }],
    columns: ['rank', 'title', 'author'],
    func: async (kwargs) => {
        const limit = Number(kwargs.limit ?? 10);
        const query = `query Sequences {
      sequences(input: {terms: {view: "communitySequences", limit: ${limit}}}) {
        results { _id title user { displayName } createdAt }
      }
    }`;
        const data = await gqlRequest(query);
        const sequences = (data?.sequences?.results ?? []);
        return sequences.map((item, i) => ({
            rank: i + 1,
            title: item.title ?? '',
            author: item.user?.displayName ?? 'Unknown',
        }));
    },
});
