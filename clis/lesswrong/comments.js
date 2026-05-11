import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { DOMAIN, SITE, gqlEscape, gqlRequest, parsePostId, stripHtml, } from './_helpers.js';
cli({
    site: SITE,
    name: 'comments',
    access: 'read',
    description: 'Top comments on a post',
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
        { name: 'limit', type: 'int', default: 5, help: 'Number of comments' },
    ],
    columns: ['rank', 'score', 'author', 'text'],
    func: async (kwargs) => {
        const postId = gqlEscape(parsePostId(String(kwargs['url-or-id'])));
        const limit = Number(kwargs.limit ?? 5);
        // Fetch post title and comments in parallel
        const [postData, commentsData] = await Promise.all([
            gqlRequest(`query PostTitle {
        post(input: {selector: {documentId: "${postId}"}}) {
          result { _id title slug }
        }
      }`),
            gqlRequest(`query Comments {
        comments(input: {terms: {view: "postCommentsTop", postId: "${postId}", limit: ${limit}}}) {
          results { _id user { displayName } baseScore htmlBody postedAt }
        }
      }`),
        ]);
        const post = postData?.post?.result;
        if (!post?._id) {
            throw new EmptyResultError('lesswrong comments', `Post "${postId}" not found`);
        }
        const comments = (commentsData?.comments?.results ?? []);
        const rows = [];
        // First row: post context
        rows.push({
            rank: '',
            score: '',
            author: '',
            text: `Comments on: ${post.title ?? 'Untitled'} (https://${DOMAIN}/posts/${post._id}/${post.slug})`,
        });
        for (let i = 0; i < comments.length; i++) {
            const item = comments[i];
            const user = item.user;
            const raw = stripHtml(item.htmlBody ?? '');
            rows.push({
                rank: i + 1,
                score: item.baseScore ?? 0,
                author: user?.displayName ?? 'Unknown',
                text: raw.length > 500 ? `${raw.slice(0, 500)}...` : raw,
            });
        }
        return rows;
    },
});
