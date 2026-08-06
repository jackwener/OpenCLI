import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    DEFAULT_LIST_LIMIT,
    MAX_LIST_LIMIT,
    buildFeedExtractorScript,
    evaluateWithPolling,
    gotoBbsHome,
    normalizeLimit,
} from './utils.js';

export const feedCommand = cli({
    site: 'xiaoheihe',
    name: 'feed',
    access: 'read',
    description: '小黑盒社区首页信息流',
    domain: 'www.xiaoheihe.cn',
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: DEFAULT_LIST_LIMIT, help: `Number of posts (1-${MAX_LIST_LIMIT})` },
    ],
    columns: ['rank', 'id', 'title', 'description', 'author', 'topic', 'likes', 'commentCount', 'createdAt', 'url'],
    example: 'opencli xiaoheihe feed --limit 10 -f json',
    func: async (page, args) => {
        const limit = normalizeLimit(args.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
        await gotoBbsHome(page);
        return evaluateWithPolling(page, buildFeedExtractorScript(limit), 'xiaoheihe/feed');
    },
});
