/**
 * 51job hot / recommended feed.
 *
 * Same endpoint as `search`, but with empty keyword — 51job returns its
 * own ranked recommendation list (up to ~999 for most regions).
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import {
    WE_ORIGIN, SEARCH_COLUMNS, SORT_CODES,
    requirePage, navigateTo, pageFetchJson,
    buildSearchUrl, mapJobItem, resolveCity, resolveCode,
} from './utils.js';

cli({
    site: '51job',
    name: 'hot',
    description: '51job 推荐职位（按城市/行业/排序浏览）',
    domain: 'we.51job.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'area', type: 'string', default: '全国', help: '城市名或 6 位城市码（默认 "全国"）' },
        { name: 'sort', type: 'string', default: '综合', help: '排序：综合 / 最新 / 薪资 / 距离' },
        { name: 'page', type: 'int', default: 1, help: '页码（1-based）' },
        { name: 'limit', type: 'int', default: 20, help: '返回条数（1-50）' },
    ],
    columns: SEARCH_COLUMNS,
    func: async (page, kwargs) => {
        requirePage(page);
        const limit = Math.max(1, Math.min(Number(kwargs.limit) || 20, 50));
        const pageNum = Math.max(1, Number(kwargs.page) || 1);
        const jobArea = resolveCity(kwargs.area);
        const sortType = resolveCode(kwargs.sort, SORT_CODES, '0');

        const currentUrl = await page.evaluate(`(() => window.location.href)()`);
        if (!String(currentUrl).startsWith(WE_ORIGIN)) {
            await navigateTo(page, `${WE_ORIGIN}/pc/search?searchType=2`, 2);
        }

        const url = buildSearchUrl({
            keyword: '', jobArea, sortType,
            pageNum, pageSize: Math.min(limit, 50),
        });
        const data = await pageFetchJson(page, url);
        if (data.status !== '1' && data.status !== 1) {
            throw new CliError('API_ERROR', `51job hot failed: ${data.message ?? 'unknown'}`);
        }
        const items = data?.resultbody?.job?.items ?? [];
        if (items.length === 0) throw new CliError('NO_DATA', 'No recommended jobs returned');
        return items.slice(0, limit).map((it, i) => mapJobItem(it, (pageNum - 1) * limit + i + 1));
    },
});
