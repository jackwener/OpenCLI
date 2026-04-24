/**
 * 51job company jobs + basic info by encCoId.
 *
 * Navigates to `jobs.51job.com/all/co<encCoId>.html`. Each job card is an
 * `<a sensorsdata="…">` whose attribute is a JSON blob with jobId, title,
 * salary, area, year, degree — so parsing is just JSON, not DOM-text fragile.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { JOBS_ORIGIN, requirePage, navigateTo, parseCompanyJobCard } from './utils.js';

cli({
    site: '51job',
    name: 'company',
    description: '51job 公司简介 + 在招职位（按 encCoId）',
    domain: 'jobs.51job.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'encCoId', type: 'string', required: true, positional: true, help: '加密公司 ID（search 返回的 encCoId）' },
        { name: 'limit', type: 'int', default: 20, help: '返回职位数（1-50）' },
    ],
    columns: [
        'rank', 'jobId', 'title', 'salary', 'city', 'workYear', 'degree',
        'funcType', 'issueDate', 'url',
        'companyName', 'companyType', 'companySize', 'companyIndustry',
        'companyIntro', 'companyUrl',
    ],
    func: async (page, kwargs) => {
        requirePage(page);
        const encCoId = String(kwargs.encCoId ?? '').trim();
        if (!encCoId) throw new CliError('INVALID_ARGUMENT', 'encCoId is required');
        if (!/^[A-Za-z0-9_]+$/.test(encCoId)) {
            throw new CliError('INVALID_ARGUMENT', `encCoId must be alphanumeric/underscore, got "${encCoId}"`);
        }
        const limit = Math.max(1, Math.min(Number(kwargs.limit) || 20, 50));

        const url = `${JOBS_ORIGIN}/all/co${encCoId}.html`;
        await navigateTo(page, url, 2);

        const script = `(() => {
            const sel = s => document.querySelector(s)?.innerText?.trim() || '';
            const bodyText = (document.body.innerText || '').slice(0, 400);
            if (/公司不存在|页面不存在|账号状态异常/.test(bodyText)) {
                return { error: 'NOT_FOUND', bodyText };
            }
            const companyName = sel('h1') || sel('.cname');
            // Company introduction block
            const introEl = document.querySelector('#companyIntroRef, .c-intro');
            const companyIntro = introEl ? (introEl.innerText || '').trim() : '';
            // Info sidebar (type / size / industry) — labels sit in .com-info dl or .coinfo
            const sidebarText = sel('.ci-content, .company-info, .coinfo, .com-info');
            const links = [...document.querySelectorAll('a[sensorsdata]')]
                .filter(a => /\\/\\d{6,}\\.html/.test(a.href || ''))
                .slice(0, 60)
                .map(a => {
                    return {
                        href: a.href,
                        sensorsdata: a.getAttribute('sensorsdata') || '',
                        text: (a.innerText || '').trim(),
                    };
                });
            // Company meta is three inline spans under .c-info.ellipsis
            // (title/size/industry) — extract them by position.
            const cInfo = document.querySelector('.c-info.ellipsis');
            const cInfoParts = cInfo
                ? [...cInfo.querySelectorAll('span')].map(s => (s.innerText || '').trim()).filter(Boolean)
                : [];
            return {
                companyName,
                companyIntro,
                links,
                cInfoParts,
                sidebarText: sidebarText.slice(0, 400),
            };
        })()`;
        const data = await page.evaluate(script);
        if (data.error === 'NOT_FOUND') {
            throw new CliError('NO_DATA', `Company ${encCoId} not found`);
        }
        if (!data.companyName) {
            throw new CliError('NO_DATA', `Could not parse company page ${encCoId}; layout may have changed`);
        }

        const companyUrl = url;
        const [companyType = '', companySize = '', companyIndustry = ''] = data.cInfoParts || [];

        const seen = new Set();
        const rows = [];
        for (const link of data.links || []) {
            const job = parseCompanyJobCard(link);
            if (!job) continue;
            if (seen.has(job.jobId)) continue;
            seen.add(job.jobId);
            rows.push({
                rank: rows.length + 1,
                ...job,
                companyName: data.companyName,
                companyType,
                companySize,
                companyIndustry,
                companyIntro: data.companyIntro || '',
                companyUrl,
            });
            if (rows.length >= limit) break;
        }
        if (rows.length === 0) {
            // Still return a sentinel row with the company info so caller isn't left with [].
            return [{
                rank: 0,
                jobId: '',
                title: '(no active jobs)',
                salary: '', city: '', workYear: '', degree: '',
                funcType: '', issueDate: '', url: '',
                companyName: data.companyName,
                companyType, companySize, companyIndustry,
                companyIntro: data.companyIntro || '',
                companyUrl,
            }];
        }
        return rows;
    },
});
