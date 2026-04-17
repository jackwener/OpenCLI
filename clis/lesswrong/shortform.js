import { cli, Strategy } from '@jackwener/opencli/registry';
import { DOMAIN, SITE, gqlRequest } from './_helpers.js';
cli({
    site: SITE,
    name: 'shortform',
    description: 'Quick takes / shortform posts',
    domain: DOMAIN,
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [{ name: 'limit', type: 'int', default: 10, help: 'Number of results' }],
    columns: ['rank', 'title', 'author', 'karma', 'comments', 'url'],
    func: async (_page, kwargs) => {
        const limit = Number(kwargs.limit ?? 10);
        const query = `query PostsList {
      posts(input: {terms: {view: "shortform", limit: ${limit}}}) {
        results { _id title user { displayName } baseScore commentCount slug postedAt tags { name } }
      }
    }`;
        const data = await gqlRequest(query);
        const posts = (data?.posts?.results ?? []);
        return posts.map((item, i) => ({
            rank: i + 1,
            title: item.title ?? '',
            author: item.user?.displayName ?? 'Unknown',
            karma: item.baseScore ?? 0,
            comments: item.commentCount ?? 0,
            url: `https://${DOMAIN}/posts/${item._id}/${item.slug}`,
        }));
    },
});
