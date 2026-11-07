import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { parseAnswerTarget } from './answer-target.js';
import { unwrapEvaluateResult } from './paginate.js';

// Self-contained: this function executes in the connected page, not in Node.
export function visibleCommentSnapshot({ answerId, open = false }) {
    const text = node => (node?.innerText || node?.textContent || '').trim();
    const visible = node => Boolean(node?.getClientRects().length) && getComputedStyle(node).visibility !== 'hidden';
    if (location.hostname !== 'www.zhihu.com' || !new RegExp('/answer/' + answerId + '/?$').test(location.pathname)) {
        return { error: 'answer_source_mismatch' };
    }
    const dialogs = [...document.querySelectorAll('.Modal-content,[role="dialog"]')].filter(visible);
    const challenges = dialogs.filter(node => !node.querySelector('.CommentContent')).map(text).join('\n');
    if (/验证码|安全验证|异常访问|访问异常|访问过于频繁|请求过于频繁|拒绝访问|无权访问|登录后查看|请登录后|登录知乎/.test(document.title + '\n' + challenges)) {
        return { error: 'authentication_or_verification_required' };
    }
    const answers = [...document.querySelectorAll('.AnswerItem')].filter(node => {
        if (node.getAttribute('name') === answerId || node.getAttribute('data-aid') === answerId) return true;
        try { return String(JSON.parse(node.getAttribute('data-zop') || '{}').itemId) === answerId; }
        catch { return false; }
    });
    if (answers.length > 1) return { error: 'ambiguous_answer' };
    if (!answers.length) return { ready: false };
    const answer = answers[0];
    const buttons = [...answer.querySelectorAll('button')].filter(node =>
        node.closest('.AnswerItem') === answer && visible(node) && /^(?:\d+\s*条评论|添加评论|评论|收起评论)$/.test(text(node)));
    if (buttons.length !== 1) return { ready: false };
    if (open) {
        if (dialogs.length || text(buttons[0]) === '收起评论') return { error: 'comment_panel_already_open' };
        buttons[0].click();
        return { opened: true };
    }
    if (text(buttons[0]) !== '收起评论') return { ready: false };
    const panels = dialogs.filter(node => node.classList.contains('Modal-content') &&
        (/^\d+\s*条评论/.test(text(node)) || node.querySelector('.CommentContent')));
    if (panels.length > 1) return { error: 'ambiguous_comment_panel' };
    if (!panels.length) return { ready: false };
    const panel = panels[0];
    const own = (node, selector) => [...node.querySelectorAll(selector)].filter(child => child.closest('[data-id]') === node);
    const nodes = [...panel.querySelectorAll('[data-id]')].filter(node => visible(node) && own(node, '.CommentContent').length === 1);
    if (nodes.length > 500) return { error: 'visible_comment_budget_exceeded' };
    const ids = new Set();
    const rows = [];
    for (const node of nodes) {
        const id = node.getAttribute('data-id');
        if (!/^\d+$/.test(id || '') || ids.has(id)) return { error: 'invalid_or_duplicate_comment_id' };
        ids.add(id);
        const content = own(node, '.CommentContent')[0].cloneNode(true);
        for (const image of content.querySelectorAll('img')) image.replaceWith(document.createTextNode(image.getAttribute('alt') || ''));
        const parent = node.parentElement?.closest('[data-id]');
        if (parent && panel.contains(parent) && !nodes.includes(parent)) return { error: 'unresolved_comment_parent' };
        rows.push({
            id, parent_id: parent && panel.contains(parent) ? parent.getAttribute('data-id') : '',
            author: own(node, 'a[href*="/people/"]').map(text).find(Boolean) || '',
            content: text(content),
            content_kind: text(content) ? 'text' : 'non_text',
            has_unexpanded_replies: own(node, 'button').some(button => /^展开.*回复|^查看.*回复/.test(text(button))),
        });
    }
    if (!rows.length && /加载失败|请求失败|网络异常/.test(text(panel))) return { error: 'comment_panel_load_failed' };
    return { ready: rows.length > 0 || /^0\s*条评论/.test(text(panel)), rows };
}

export async function readVisibleComments(page, kwargs) {
    const target = parseAnswerTarget(kwargs.id);
    if (!target) throw new ArgumentError('Use a numeric answer ID, full answer URL, or answer:<qid>:<aid>.');
    const limit = Number(kwargs.limit ?? 5), replies = Number(kwargs['replies-limit'] ?? 1);
    if (!Number.isInteger(limit) || limit < 1 || limit > 20 || !Number.isInteger(replies) || replies < 0 || replies > 10) {
        throw new ArgumentError('--limit must be 1..20 and --replies-limit must be 0..10.');
    }
    await page.goto(`https://www.zhihu.com/answer/${target.answerId}`);
    const snapshot = async open => {
        const value = unwrapEvaluateResult(await page.evaluate(visibleCommentSnapshot, { answerId: target.answerId, open }));
        if (!value || typeof value !== 'object' || value.error) {
            throw new CommandExecutionError(`Zhihu visible comments stopped: ${value?.error || 'invalid_page_result'}`,
                'Check the answer in the connected browser. No API fallback or automatic retry is performed.');
        }
        return value;
    };
    // Wait only for rendering. The panel is clicked once; replies are never expanded.
    let opened = false, result;
    for (let i = 0; i < 20; i++) {
        result = await snapshot(!opened);
        if (result.opened) opened = true;
        else if (opened && result.ready) break;
        if (i < 19) await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (!opened || !result?.ready) throw new CommandExecutionError('Zhihu comment panel did not finish rendering.');
    if (!result.rows.length) throw new EmptyResultError('zhihu answer-comments-visible', 'The answer page displays zero comments.');
    const selected = [], roots = result.rows.filter(row => !row.parent_id).slice(0, limit);
    const url = `https://www.zhihu.com/answer/${target.answerId}`;
    for (const root of roots) {
        const append = (row, depth) => selected.push({ ...row, depth, url, reader: 'visible_dom', order: 'page_default', complete: false });
        append(root, 0);
        const descendants = new Set([root.id]);
        let count = 0;
        for (const row of result.rows) {
            if (!row.parent_id || !descendants.has(row.parent_id) || count >= replies) continue;
            const parent = selected.find(item => item.id === row.parent_id);
            append(row, parent.depth + 1); descendants.add(row.id); count++;
        }
    }
    return selected.map((row, i) => ({ rank: i + 1, ...row }));
}

cli({
    site: 'zhihu', name: 'answer-comments-visible', access: 'read',
    description: 'Read only currently rendered answer comments; no API fallback or reply expansion',
    domain: 'www.zhihu.com', strategy: Strategy.COOKIE,
    args: [
        { name: 'id', positional: true, required: true, help: 'Answer ID, URL, or answer:<qid>:<aid>' },
        { name: 'limit', type: 'int', default: 5, help: 'Maximum visible root comments (1..20)' },
        { name: 'replies-limit', type: 'int', default: 1, help: 'Maximum already-visible descendants per root (0..10)' },
    ],
    columns: ['rank', 'id', 'parent_id', 'depth', 'author', 'content', 'content_kind', 'has_unexpanded_replies', 'reader', 'order', 'complete', 'url'],
    func: readVisibleComments,
});
