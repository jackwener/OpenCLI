import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    absoluteResumeUrl,
    positiveInteger,
    requiredText,
    textOrNull,
    valueFrom,
} from './utils.js';

const SEARCH_URL = 'https://lpt.liepin.com/search';

function searchInput(query, page) {
    const input = {
        suggestKey: '',
        searchRefer: '1',
        cvSearchForm: 0,
        searchKey: '',
        filterKey: '',
        degrade: '',
        csCreateTimeFlag: '',
        csCreateTime: '',
        csId: '',
        curPage: page - 1,
        keys: query,
        showKeys: query,
        searchLevel: '',
        dqs: '',
        wantDqs: '',
        workyears: '0,99',
        eduLevels: [],
        industrys: '',
        jobtitles: '',
        wantIndustrys: '',
        wantJobTitles: '',
        activeStatus: '',
        userStatus: '',
        yearSalarylow: '',
        yearSalaryhigh: '',
        wantYearSalaryLow: '',
        wantYearSalaryHigh: '',
        sex: '',
        age: '',
        special: '',
        sortflag: '',
        filterRead: '',
        filterChat: '',
        filterDownload: '',
        titleSearchFilter: '0',
        compSearchFilter: '0',
        interactiveVersion: 'v2',
        jobId: '',
    };
    return input;
}

function mapCandidate(item, index) {
    const resume = item?.resume ?? item?.resumeInfo ?? item?.resumeData ?? {};
    const current = item?.latestWork ?? item?.workExpList?.[0] ?? resume?.workExpList?.[0] ?? {};
    const wanted = item?.jobWant ?? resume?.jobWant ?? {};
    const resumeId = valueFrom([item, resume], ['resIdEncode', 'enresId', 'resumeId']);
    return {
        rank: index + 1,
        resume_id: resumeId,
        opposite_im_id: valueFrom([item, resume], ['oppositeImId', 'imId', 'usercImId']),
        name: valueFrom([item, resume], ['showName', 'name', 'resumeName', 'usercName']),
        active_status: valueFrom([item, resume], ['activeStatus', 'activeStatusName']),
        age: valueFrom([item, resume], ['showAge', 'age']),
        work_years: valueFrom([item, resume], ['workYearsShow', 'workyears', 'workYears']),
        degree: valueFrom([item, resume], ['eduLevelShow', 'eduLevelName', 'degree']),
        location: valueFrom([item, resume], ['dqName', 'cityName', 'location']),
        desired_title: valueFrom([wanted, item, resume], ['wantTitle', 'wantJobTitle', 'desiredTitle']),
        latest_company: valueFrom([current, item, resume], ['rwdCompname', 'compName', 'latestCompany']),
        latest_title: valueFrom([current, item, resume], ['rwdsTitle', 'jobTitle', 'latestTitle']),
        url: absoluteResumeUrl(
            valueFrom([item, resume], ['resumeUrl', 'resumeDetailUrl', 'url']),
            resumeId,
        ),
    };
}

async function selectSearchPage(page, pageNumber) {
    if (pageNumber <= 1) return;
    const selected = await page.evaluate((target) => {
        const button = [...document.querySelectorAll('button, [role="button"]')]
            .find((node) => node.textContent?.trim() === String(target));
        if (!(button instanceof HTMLElement)) return false;
        button.click();
        return true;
    }, pageNumber);
    if (!selected) throw new EmptyResultError('liepin search', `搜索结果没有第 ${pageNumber} 页`);
    if (typeof page.wait === 'function') await page.wait({ time: 2 });
    else await new Promise((resolve) => setTimeout(resolve, 2000));
}

cli({
    site: 'liepin',
    name: 'search',
    access: 'read',
    description: '搜索猎聘企业版人才库',
    domain: 'lpt.liepin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    defaultWindowMode: 'background',
    siteSession: 'persistent',
    args: [
        { name: 'query', type: 'string', required: true, positional: true, help: '人才搜索关键词' },
        { name: 'page', type: 'int', default: 1, help: '页码（从 1 开始）' },
        { name: 'limit', type: 'int', default: 20, help: '返回数量（1-20）' },
    ],
    columns: [
        'rank', 'resume_id', 'opposite_im_id', 'name', 'active_status', 'age',
        'work_years', 'degree', 'location', 'desired_title', 'latest_company',
        'latest_title', 'url', 'summary',
        'source',
    ],
    func: async (page, args) => {
        const query = requiredText(args.query, 'query');
        if (query.length > 100) throw new ArgumentError('liepin query must be <= 100 characters');
        const pageNumber = positiveInteger(args.page, 'page', 1);
        const limit = positiveInteger(args.limit, 'limit', 20, 20);
        await page.goto(SEARCH_URL, { settleMs: 3000 });
        await page.evaluate((keywords) => {
            const input = document.querySelector('input[placeholder*="搜索"], input[aria-label*="搜索"]');
            if (!(input instanceof HTMLInputElement)) throw new Error('未找到人才搜索框');
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            setter?.call(input, keywords);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            const searchButton = [...document.querySelectorAll('button')]
                .find((node) => node.children.length === 0 && node.textContent?.trim() === '搜索');
            searchButton?.click();
        }, query);
        if (typeof page.wait === 'function') await page.wait({ time: 4 });
        else await new Promise((resolve) => setTimeout(resolve, 4000));
        await selectSearchPage(page, pageNumber);
        const allRows = await page.evaluate(() => [...document.querySelectorAll('li[data-resumeidencode]')]
            .filter((card) => card.getClientRects().length > 0)
            .map((card, index) => {
                const name = card.querySelector('[data-name], [aria-label]')?.textContent?.trim() || null;
                const detail = card.textContent?.trim() || '';
                return {
                    rank: index + 1,
                    resume_id: card.getAttribute('data-resumeidencode'),
                    opposite_im_id: null,
                    name,
                    active_status: null,
                    age: null,
                    work_years: null,
                    degree: null,
                    location: null,
                    desired_title: null,
                    latest_company: null,
                    latest_title: null,
                    url: card.getAttribute('data-resumeurl'),
                    summary: detail,
                    source: 'dom',
                };
            })
            .filter((row) => row.resume_id || row.name));
        const rows = allRows.slice(0, limit);
        if (rows.length === 0) throw new EmptyResultError('liepin search', `没有找到与“${query}”匹配的人才`);
        return rows;
    },
});

export const __test__ = { mapCandidate, searchInput };
