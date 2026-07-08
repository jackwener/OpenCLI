/**
 * 51job job detail by jobId.
 *
 * Navigates to `jobs.51job.com/x/<jobId>.html` (SSR page — the generic `/x/`
 * area slug always resolves) and scrapes the structured blocks. No API
 * surface returns the full detail page, so DOM scraping is the only path.
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { JOBS_ORIGIN, requirePage, navigateTo } from './utils.js';

cli({
    site: '51job',
    name: 'detail',
    access: 'read',
    description: '51job 职位详情（按 jobId）',
    domain: 'jobs.51job.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'jobId', type: 'string', required: true, positional: true, help: '职位 ID（search 返回的 jobId）' },
    ],
    columns: [
        'jobId', 'title', 'salary', 'location', 'workYear', 'degree',
        'category', 'address', 'ageRequirement',
        'description', 'welfare',
        'company', 'companyType', 'companySize', 'companyIndustry',
        'companyUrl', 'url',
    ],
    func: async (page, kwargs) => {
        requirePage(page);
        const jobId = String(kwargs.jobId ?? '').trim();
        if (!jobId) throw new CliError('INVALID_ARGUMENT', 'jobId is required');
        if (!/^\d{6,12}$/.test(jobId)) throw new CliError('INVALID_ARGUMENT', `jobId must be a 6-12 digit number, got "${jobId}"`);

        const url = `${JOBS_ORIGIN}/x/${jobId}.html`;
        await navigateTo(page, url, 2);

        const script = `(() => {
            const sel = s => document.querySelector(s)?.innerText?.trim() || '';
            const all = s => [...document.querySelectorAll(s)].map(e => e.innerText.trim()).filter(Boolean);
            const finalUrl = window.location.href;
            const bodyText = (document.body.innerText || '').slice(0, 400);
            if (/职位已下线|该职位已删除|页面不存在/.test(bodyText)) {
                return { error: 'EXPIRED', bodyText };
            }
            const companyA = document.querySelector('.cname a, .tCompany_sidebar .com_msg a');
            const funcs = all('.bmsg .fp');
            const pick = (prefix) => {
                const row = funcs.find(f => f.startsWith(prefix));
                return row ? row.slice(prefix.length).replace(/^[:：\\s\\n]+/, '').trim() : '';
            };
            return {
                finalUrl,
                title: sel('h1') || sel('.cn .name'),
                salary: sel('.cn strong') || sel('strong'),
                meta: sel('.cn .msg.ltype') || sel('.msg.ltype'),
                description: (() => {
                    const box = document.querySelector('.bmsg.job_msg') || document.querySelector('.job_msg');
                    if (!box) return '';
                    const clone = box.cloneNode(true);
                    clone.querySelectorAll('.fp, .mt10, script, style').forEach(n => n.remove());
                    return (clone.innerText || '').trim();
                })(),
                welfare: all('.t1 span, .jtag .t1 span'),
                category: pick('职能类别'),
                address: pick('上班地址'),
                ageRequirement: pick('年龄要求'),
                company: companyA?.innerText?.trim() || '',
                companyUrl: companyA?.href || '',
                companyTag: sel('.com_tag'),
            };
        })()`;
        const data = await page.evaluate(script);
        if (data.error === 'EXPIRED') {
            throw new CliError('NO_DATA', `Job ${jobId} is offline or removed`);
        }
        if (!data.title) {
            throw new CliError('NO_DATA', `Could not parse job detail for ${jobId}; page may have changed layout`);
        }

        // meta looks like "北京-丰台区  |  3年及以上  |  本科"
        const [locRaw, workYear, degree] = (data.meta || '').split('|').map(s => s.trim());
        // companyTag looks like "国企\n\n150-500人\n\n电子技术/半导体/集成电路"
        const tagParts = (data.companyTag || '').split(/\n+/).map(s => s.trim()).filter(Boolean);

        return [{
            jobId,
            title: data.title,
            salary: data.salary || '',
            location: locRaw || '',
            workYear: workYear || '',
            degree: degree || '',
            category: data.category || '',
            address: data.address || '',
            ageRequirement: data.ageRequirement || '',
            description: data.description || '',
            welfare: (data.welfare || []).join(','),
            company: data.company || '',
            companyType: tagParts[0] || '',
            companySize: tagParts[1] || '',
            companyIndustry: tagParts.slice(2).join(' / '),
            companyUrl: data.companyUrl || '',
            url: data.finalUrl || url,
        }];
    },
});
