import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    DEFAULT_LIST_LIMIT,
    MAX_LIST_LIMIT,
    buildTopicsExtractorScript,
    evaluateWithPolling,
    gotoBbsHome,
    normalizeLimit,
} from './utils.js';

export const topicsCommand = cli({
    site: 'xiaoheihe',
    name: 'topics',
    access: 'read',
    description: '小黑盒热门社区/话题列表',
    domain: 'www.xiaoheihe.cn',
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: DEFAULT_LIST_LIMIT, help: `Number of topics (1-${MAX_LIST_LIMIT})` },
    ],
    columns: ['rank', 'id', 'name', 'hotValue', 'icon', 'url'],
    example: 'opencli xiaoheihe topics --limit 10 -f json',
    func: async (page, args) => {
        const limit = normalizeLimit(args.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
        await gotoBbsHome(page);
        return evaluateWithPolling(page, buildTopicsExtractorScript(limit), 'xiaoheihe/topics');
    },
});
