import { cli, Strategy } from '@jackwener/opencli/registry';
import { clampInt } from '../_shared/common.js';
import { extractLawResults, navigateViaVueRouter } from './shared.js';

cli({
    site: 'gov-law',
    name: 'recent',
    access: 'read',
    description: '最新法律法规',
    domain: 'flk.npc.gov.cn',
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 10, help: '返回结果数量 (max 20)' },
    ],
    columns: ['rank', 'title', 'status', 'publish_date', 'type', 'department'],
    navigateBefore: false,
    func: async (page, kwargs) => {
        const limit = clampInt(kwargs.limit, 10, 1, 20);
        await navigateViaVueRouter(page, {});
        return extractLawResults(page, limit);
    },
});
