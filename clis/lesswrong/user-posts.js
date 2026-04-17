import { cli, Strategy } from '@jackwener/opencli/registry';
import { DOMAIN, SITE, gqlEscape, gqlRequest, resolveUserId } from './_helpers.js';
cli({
    site: SITE,
    name: 'user-posts',
    description: "List a user's posts",
    domain: DOMAIN,
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        {
            name: 'username',
            type: 'string',
            required: true,
            positional: true,
            help: 'LessWrong username or slug',
        },
        { name: 'limit', type: 'int', default: 10, help: 'Number of results' },
    ],
    columns: ['rank', 'title', 'karma', 'comments', 'date', 'url'],
    func: async (_page, kwargs) => {
        const username = String(kwargs.username);
        const limit = Number(kwargs.limit ?? 10);
        const user = await resolveUserId(username);
        const query = `query UserPosts {
      posts(input: {terms: {view: "userPosts", userId: "${gqlEscape(user._id)}", limit: ${limit}}}) {
        results { _id title baseScore commentCount slug postedAt }
      }
    }`;
        const data = await gqlRequest(query);
        const posts = (data?.posts?.results ?? []);
        return posts.map((item, i) => ({
            rank: i + 1,
            title: item.title ?? '',
            karma: item.baseScore ?? 0,
            comments: item.commentCount ?? 0,
            date: item.postedAt ?? '',
            url: `https://${DOMAIN}/posts/${item._id}/${item.slug}`,
        }));
    },
});
