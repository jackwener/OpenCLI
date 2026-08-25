import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { requireConfirmation, requiredText } from './utils.js';

const SEARCH_URL = 'https://lpt.liepin.com/search';

function parseResumeIds(raw) {
    const ids = [...new Set(String(raw).split(',').map((item) => item.trim()).filter(Boolean))];
    if (ids.length === 0) throw new ArgumentError('liepin greet-search-results resumeIds is required');
    if (ids.length > 20) throw new ArgumentError('liepin greet-search-results supports at most 20 candidates');
    return ids;
}

async function searchCandidates(page, query) {
    await page.goto(SEARCH_URL, { settleMs: 3000 });
    await page.evaluate((keywords) => {
        const input = document.querySelector('input.searchInput--XzkyN');
        if (!(input instanceof HTMLInputElement)) throw new Error('未找到人才搜索框');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, keywords);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const searchButton = [...document.querySelectorAll('button, span, div')]
            .find((node) => node.children.length === 0 && node.textContent?.trim() === '搜索');
        searchButton?.click();
    }, query);
    await new Promise((resolve) => setTimeout(resolve, 4000));
}

cli({
    site: 'liepin',
    name: 'greet-search-results',
    access: 'write',
    description: '向猎聘搜索结果中的候选人发送已配置的职位打招呼语',
    domain: 'lpt.liepin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    defaultWindowMode: 'background',
    siteSession: 'persistent',
    args: [
        { name: 'resumeIds', type: 'string', required: true, positional: true, help: '加密简历 ID，逗号分隔' },
        { name: 'query', type: 'string', default: '生鲜 定价 毛利', help: '用于定位候选人的搜索关键词' },
        { name: 'jobTitle', type: 'string', default: '生鲜价格策略专家', help: '开聊时关联的职位名称' },
        { name: 'confirm', type: 'boolean', default: false, help: '必须显式传 true 才会发送' },
    ],
    columns: ['resume_id', 'name', 'ready', 'status'],
    func: async (page, args) => {
        requireConfirmation(args.confirm, 'greet-search-results');
        const resumeIds = parseResumeIds(args.resumeIds);
        const query = requiredText(args.query, 'query');
        const jobTitle = requiredText(args.jobTitle, 'jobTitle');
        await searchCandidates(page, query);
        const rows = [];
        for (const resumeId of resumeIds) {
            const candidate = await page.evaluate((id) => {
                const card = document.querySelector(`li[data-resumeidencode="${CSS.escape(id)}"]`);
                if (!(card instanceof HTMLElement) || card.getClientRects().length === 0) return null;
                const name = card.querySelector('.nest-resume-personal-name')?.textContent?.trim() || null;
                const action = [...card.querySelectorAll('*')]
                    .find((node) => node.children.length === 0 && node.textContent?.trim() === '立即沟通');
                if (!(action instanceof HTMLElement)) return { name, ready: false };
                action.click();
                return { name, ready: true };
            }, resumeId);
            if (!candidate) {
                rows.push({ resume_id: resumeId, name: null, ready: false, status: 'not_found' });
                continue;
            }
            if (!candidate.ready) {
                rows.push({ resume_id: resumeId, name: candidate.name, ready: false, status: 'already_contacted' });
                continue;
            }
            await new Promise((resolve) => setTimeout(resolve, 700));
            const opened = await page.evaluate((title) => {
                const job = [...document.querySelectorAll('*')]
                    .find((node) => node.children.length === 0 && node.textContent?.trim().startsWith(title));
                if (!(job instanceof HTMLElement)) return false;
                job.click();
                const confirm = [...document.querySelectorAll('*')]
                    .find((node) => node.children.length === 0 && node.textContent?.trim() === '确认');
                if (!(confirm instanceof HTMLElement)) return false;
                confirm.click();
                return true;
            }, jobTitle);
            await new Promise((resolve) => setTimeout(resolve, 1000));
            rows.push({
                resume_id: resumeId,
                name: candidate.name,
                ready: true,
                status: opened ? 'greeting_sent' : 'job_selection_failed',
            });
        }
        if (rows.every((row) => row.status === 'not_found')) {
            throw new EmptyResultError('liepin greet-search-results', '搜索结果中没有找到指定候选人');
        }
        return rows;
    },
});

export const __test__ = { parseResumeIds };
