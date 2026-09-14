import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    DEFAULT_COMMENT_LIMIT,
    MAX_COMMENT_LIMIT,
    buildPostExtractorScript,
    evaluateWithPolling,
    gotoPost,
    normalizeLimit,
} from './utils.js';

export const postCommand = cli({
    site: 'xiaoheihe',
    name: 'post',
    access: 'read',
    description: '小黑盒帖子正文和首屏回复',
    domain: 'www.xiaoheihe.cn',
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'post', positional: true, required: true, type: 'string', help: 'Post id or xiaoheihe post URL' },
        { name: 'limit', type: 'int', default: DEFAULT_COMMENT_LIMIT, help: `Number of comments/replies (1-${MAX_COMMENT_LIMIT})` },
        { name: 'include-comments', type: 'boolean', default: true, help: 'Include comments and nested replies' },
    ],
    columns: [
        'type',
        'id',
        'parentId',
        'author',
        'replyTo',
        'title',
        'content',
        'likes',
        'replyCount',
        'createdAt',
        'ipLocation',
        'url',
    ],
    example: 'opencli xiaoheihe post 184169654 --limit 20 -f json',
    func: async (page, args) => {
        const { id } = await gotoPost(page, args.post);
        const limit = normalizeLimit(args.limit, DEFAULT_COMMENT_LIMIT, MAX_COMMENT_LIMIT);
        const includeComments = args['include-comments'] !== false;
        return evaluateWithPolling(page, buildPostExtractorScript(id, limit, includeComments), 'xiaoheihe/post');
    },
});
