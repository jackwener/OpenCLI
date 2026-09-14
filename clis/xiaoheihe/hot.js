import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    DEFAULT_LIST_LIMIT,
    MAX_LIST_LIMIT,
    buildHotExtractorScript,
    evaluateWithPolling,
    gotoBbsHome,
    normalizeLimit,
} from './utils.js';

export const hotCommand = cli({
    site: 'xiaoheihe',
    name: 'hot',
    access: 'read',
    description: '小黑盒社区热门帖子（按互动数排序）',
    domain: 'www.xiaoheihe.cn',
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: DEFAULT_LIST_LIMIT, help: `Number of posts (1-${MAX_LIST_LIMIT})` },
    ],
    columns: ['rank', 'id', 'title', 'description', 'author', 'topic', 'likes', 'commentCount', 'createdAt', 'url'],
    example: 'opencli xiaoheihe hot --limit 10 -f json',
    func: async (page, args) => {
        const limit = normalizeLimit(args.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
        await gotoBbsHome(page);
        return evaluateWithPolling(page, buildHotExtractorScript(limit), 'xiaoheihe/hot');
    },
});
