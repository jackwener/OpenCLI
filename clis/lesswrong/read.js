import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { DOMAIN, SITE, gqlEscape, gqlRequest, parsePostId, stripHtml, } from './_helpers.js';
cli({
    site: SITE,
    name: 'read',
    access: 'read',
    description: 'Read full post by URL or ID',
    domain: DOMAIN,
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        {
            name: 'url-or-id',
            type: 'string',
            required: true,
            positional: true,
            help: 'Post URL or LessWrong post ID',
        },
    ],
    columns: ['title', 'author', 'karma', 'comments', 'tags', 'content', 'url'],
    func: async (kwargs) => {
        const postId = parsePostId(String(kwargs['url-or-id']));
        const query = `query PostsSingle {
      post(input: {selector: {documentId: "${gqlEscape(postId)}"}}) {
        result { _id title user { displayName } baseScore commentCount htmlBody slug postedAt tags { name } }
      }
    }`;
        const data = await gqlRequest(query);
        const post = data?.post?.result;
        if (!post?._id) {
            throw new EmptyResultError('lesswrong read', `Post "${postId}" not found`);
        }
        return [
            {
                title: post.title ?? '',
                author: post.user?.displayName ?? 'Unknown',
                karma: post.baseScore ?? 0,
                comments: post.commentCount ?? 0,
                tags: (post.tags ?? []).map((tag) => tag.name ?? '').filter(Boolean).join(', '),
                content: stripHtml(post.htmlBody ?? ''),
                url: `https://${DOMAIN}/posts/${post._id}/${post.slug}`,
            },
        ];
    },
});
