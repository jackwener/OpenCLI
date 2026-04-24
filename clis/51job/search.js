/**
 * 51job keyword search.
 *
 * Backed by `we.51job.com/api/job/search-pc`, which returns a job list with
 * the full `jobDescribe` embedded. Needs the browser session because the
 * Aliyun WAF in front of `we.51job.com` challenges bare fetches; the
 * `pageFetchJson` helper runs inside the page so the WAF sees a real browser.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import {
    WE_ORIGIN, SEARCH_COLUMNS,
    SALARY_CODES, WORKYEAR_CODES, DEGREE_CODES,
    COMPANY_TYPE_CODES, COMPANY_SIZE_CODES, SORT_CODES,
    requirePage, navigateTo, pageFetchJson,
    buildSearchUrl, mapJobItem, resolveCity, resolveCode,
} from './utils.js';

cli({
    site: '51job',
    name: 'search',
    description: '51job 前程无忧关键词职位搜索',
    domain: 'we.51job.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'keyword', type: 'string', required: true, positional: true, help: '搜索关键词（岗位名 / 技能 / 公司）' },
        { name: 'area', type: 'string', default: '全国', help: '城市名或 6 位城市码（如 "杭州" / "080200" / "全国"）' },
        { name: 'salary', type: 'string', default: '', help: '薪资区间（如 "10-15k" / "1-1.5万" / "20-30k"）' },
        { name: 'experience', type: 'string', default: '', help: '工作年限（如 "应届" / "1-3年" / "3-5年" / "5-7年"）' },
        { name: 'degree', type: 'string', default: '', help: '学历要求（如 "本科" / "大专" / "硕士"）' },
        { name: 'companyType', type: 'string', default: '', help: '公司性质（如 "外资" / "国企" / "民营"）' },
        { name: 'companySize', type: 'string', default: '', help: '公司规模（如 "50-150" / "1000-5000"）' },
        { name: 'sort', type: 'string', default: '综合', help: '排序：综合 / 最新 / 薪资 / 距离' },
        { name: 'page', type: 'int', default: 1, help: '页码（1-based）' },
        { name: 'limit', type: 'int', default: 20, help: '返回条数（1-50）' },
    ],
    columns: SEARCH_COLUMNS,
    func: async (page, kwargs) => {
        requirePage(page);
        const keyword = String(kwargs.keyword ?? '').trim();
        if (!keyword) throw new CliError('INVALID_ARGUMENT', 'keyword is required');
        const limit = Math.max(1, Math.min(Number(kwargs.limit) || 20, 50));
        const pageNum = Math.max(1, Number(kwargs.page) || 1);

        const jobArea = resolveCity(kwargs.area);
        const salary = resolveCode(kwargs.salary, SALARY_CODES);
        const workYear = resolveCode(kwargs.experience, WORKYEAR_CODES);
        const degree = resolveCode(kwargs.degree, DEGREE_CODES);
        const companyType = resolveCode(kwargs.companyType, COMPANY_TYPE_CODES);
        const companySize = resolveCode(kwargs.companySize, COMPANY_SIZE_CODES);
        const sortType = resolveCode(kwargs.sort, SORT_CODES, '0');

        // Establish WAF-clean origin. Reusing the same tab avoids the slider
        // challenge fire every call.
        const currentUrl = await page.evaluate(`(() => window.location.href)()`);
        if (!String(currentUrl).startsWith(WE_ORIGIN)) {
            await navigateTo(page, `${WE_ORIGIN}/pc/search?keyword=${encodeURIComponent(keyword)}&searchType=2`, 2);
        }

        const url = buildSearchUrl({
            keyword, jobArea, salary, workYear, degree,
            companyType, companySize, sortType,
            pageNum, pageSize: Math.min(limit, 50),
        });

        const data = await pageFetchJson(page, url);
        if (data.status !== '1' && data.status !== 1) {
            throw new CliError('API_ERROR', `51job search failed: ${data.message ?? 'unknown'}`);
        }
        const items = data?.resultbody?.job?.items ?? [];
        if (items.length === 0) {
            throw new CliError('NO_DATA', `No jobs matched "${keyword}"`);
        }
        return items.slice(0, limit).map((it, i) => mapJobItem(it, (pageNum - 1) * limit + i + 1));
    },
});
