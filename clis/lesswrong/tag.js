import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { DOMAIN, SITE, gqlRequest, resolveTagId } from './_helpers.js';
cli({
    site: SITE,
    name: 'tag',
    description: 'Posts by tag',
    domain: DOMAIN,
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        {
            name: 'tag',
            type: 'string',
            required: true,
            positional: true,
            help: 'Tag slug or name',
        },
        { name: 'limit', type: 'int', default: 10, help: 'Number of results' },
    ],
    columns: ['rank', 'title', 'author', 'karma', 'comments', 'url'],
    func: async (_page, kwargs) => {
        const tagInput = String(kwargs.tag);
        const limit = Number(kwargs.limit ?? 10);
        const tag = await resolveTagId(tagInput);
        if (!tag?._id) {
            throw new EmptyResultError(`lesswrong tag ${tagInput}`, 'Use "opencli lesswrong tags" to list available tags');
        }
        const query = `query PostsByTag {
      posts(input: {terms: {view: "tagRelevance", tagId: "${tag._id}", limit: ${limit}}}) {
        results { _id title user { displayName } baseScore commentCount slug postedAt }
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
