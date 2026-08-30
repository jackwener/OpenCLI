import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { requireConfirmation, requiredText } from './utils.js';

const SEARCH_URL = 'https://lpt.liepin.com/search';
const ALLOWED_DIALOG_TEXT = '请选择开聊职位';

function parseResumeIds(raw) {
    const ids = [...new Set(String(raw).split(',').map((item) => item.trim()).filter(Boolean))];
    if (ids.length === 0) throw new ArgumentError('liepin greet-search-results resumeIds is required');
    if (ids.length > 20) throw new ArgumentError('liepin greet-search-results supports at most 20 candidates');
    return ids;
}

async function searchCandidates(page, query) {
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
    await new Promise((resolve) => setTimeout(resolve, 4000));
}

function classifyDialog(textContent) {
    const text = String(textContent || '').replace(/\s+/g, ' ').trim();
    if (text.includes(ALLOWED_DIALOG_TEXT)) return 'job_selection';
    return 'needs_human';
}

function planCandidateAction(buttonText, dryRun = false) {
    if (buttonText === null || buttonText === undefined) return 'not_found';
    if (buttonText === '继续沟通') return 'already_contacted';
    return dryRun ? 'planned' : 'ready';
}

async function visibleDialog(page) {
    return page.evaluate(() => {
        const dialogs = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')]
            .filter((node) => node instanceof HTMLElement && node.getClientRects().length > 0);
        return dialogs.at(-1)?.textContent?.trim() || '';
    });
}

async function verifyGreeting(page, resumeId) {
    try { await page.wait({ text: '继续沟通', timeout: 3 }); } catch { /* inspect below */ }
    const cardVerified = await page.evaluate((id) => {
        const card = document.querySelector(`li[data-resumeidencode="${CSS.escape(id)}"]`);
        return Boolean(card && [...card.querySelectorAll('button')].some((node) => node.textContent?.trim() === '继续沟通'));
    }, resumeId).catch(() => false);
    if (cardVerified) return true;
    const requests = typeof page.networkRequests === 'function' ? await page.networkRequests() : [];
    return requests.some((item) => /chat|communicat|greet|open.?im|im\.b/i.test(String(item?.url || '')));
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
        { name: 'dry-run', type: 'boolean', default: false, help: '只定位并输出计划，不点击立即沟通' },
    ],
    columns: ['resume_id', 'name', 'ready', 'status', 'reason'],
    func: async (page, args) => {
        const dryRun = args['dry-run'] === true;
        if (!dryRun) requireConfirmation(args.confirm, 'greet-search-results');
        const resumeIds = parseResumeIds(args.resumeIds);
        const query = requiredText(args.query, 'query');
        const jobTitle = requiredText(args.jobTitle, 'jobTitle');
        await searchCandidates(page, query);
        const rows = [];
        for (const resumeId of resumeIds) {
            const candidate = await page.evaluate((id) => {
                const card = document.querySelector(`li[data-resumeidencode="${CSS.escape(id)}"]`);
                if (!(card instanceof HTMLElement) || card.getClientRects().length === 0) return null;
                const name = card.querySelector('[data-name], [aria-label]')?.textContent?.trim() || null;
                const buttons = [...card.querySelectorAll('button')];
                const button = buttons.find((node) => ['立即沟通', '继续沟通'].includes(node.textContent?.trim()));
                return [name, button?.textContent?.trim() || ''];
            }, resumeId);
            const [candidateName, buttonText] = candidate || [null, null];
            const plan = planCandidateAction(buttonText, dryRun);
            if (plan === 'not_found') {
                rows.push({ resume_id: resumeId, name: null, ready: false, status: plan, reason: null });
                continue;
            }
            if (plan === 'already_contacted') {
                rows.push({ resume_id: resumeId, name: candidateName, ready: false, status: plan, reason: null });
                continue;
            }
            if (dryRun) {
                rows.push({ resume_id: resumeId, name: candidateName, ready: true, status: plan, reason: 'dry_run' });
                continue;
            }
            await page.evaluate((id) => {
                const card = document.querySelector(`li[data-resumeidencode="${CSS.escape(id)}"]`);
                const button = [...(card?.querySelectorAll('button') || [])]
                    .find((node) => node.textContent?.trim() === '立即沟通');
                button?.click();
            }, resumeId);
            let dialogText = '';
            try { await page.wait({ text: ALLOWED_DIALOG_TEXT, timeout: 5 }); } catch { /* inspect alternate modal */ }
            dialogText = await visibleDialog(page);
            const dialog = classifyDialog(dialogText);
            if (dialog !== 'job_selection') {
                rows.push({ resume_id: resumeId, name: candidateName, ready: true, status: 'needs_human', reason: dialogText.replace(/\s+/g, ' ').trim().slice(0, 240) || 'modal_not_rendered' });
                continue;
            }
            const jobFound = await page.evaluate((title) => {
                const dialogNode = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')]
                    .find((node) => node instanceof HTMLElement && node.getClientRects().length > 0);
                const job = [...(dialogNode?.querySelectorAll('button, [role="button"], label') || [])]
                    .find((node) => node.textContent?.trim().startsWith(title));
                if (!(job instanceof HTMLElement)) return false;
                job.click();
                return true;
            }, jobTitle);
            if (!jobFound) {
                rows.push({ resume_id: resumeId, name: candidateName, ready: true, status: 'job_selection_failed', reason: 'job_not_found' });
                continue;
            }
            const confirmed = await page.evaluate(() => {
                const dialogNode = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')]
                    .find((node) => node instanceof HTMLElement && node.getClientRects().length > 0);
                const button = [...(dialogNode?.querySelectorAll('button, [role="button"]') || [])]
                    .find((node) => node.textContent?.trim() === '确认');
                if (!(button instanceof HTMLElement)) return false;
                button.click();
                return true;
            });
            if (!confirmed) {
                rows.push({ resume_id: resumeId, name: candidateName, ready: true, status: 'job_selection_failed', reason: 'confirm_failed' });
                continue;
            }
            const verified = await verifyGreeting(page, resumeId);
            rows.push({
                resume_id: resumeId,
                name: candidateName,
                ready: true,
                status: verified ? 'greeting_sent' : 'send_unverified',
                reason: verified ? null : 'confirm_failed',
            });
        }
        if (rows.every((row) => row.status === 'not_found')) {
            throw new EmptyResultError('liepin greet-search-results', '搜索结果中没有找到指定候选人');
        }
        return rows;
    },
});

export const __test__ = { parseResumeIds, classifyDialog, planCandidateAction };
