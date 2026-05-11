import { EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildTiebaPostCardsFromPagePc, buildTiebaPostItems, normalizeTiebaLimit, signTiebaPcParams, } from './utils.js';
function getForumPageNumber(kwargs) {
    return Math.max(1, Number(kwargs.page || 1));
}
function getForumUrl(kwargs) {
    const forum = String(kwargs.forum || '');
    return `https://tieba.baidu.com/f?kw=${encodeURIComponent(forum)}&ie=utf-8&pn=${(getForumPageNumber(kwargs) - 1) * 50}`;
}
/**
 * Rebuild the signed page_pc request instead of scraping only the visible thread cards.
 */
function buildTiebaPagePcParams(kwargs, limit) {
    return {
        kw: encodeURIComponent(String(kwargs.forum || '')),
        pn: String(getForumPageNumber(kwargs)),
        sort_type: '-1',
        is_newfrs: '1',
        is_newfeed: '1',
        rn: '30',
        rn_need: String(Math.min(Math.max(limit + 10, 10), 30)),
        tbs: '',
        subapp_type: 'pc',
        _client_type: '20',
    };
}
/**
 * Tieba expects the signed forum-list request to be replayed with the browser's cookies.
 */
async function fetchTiebaPagePc(page, kwargs, limit) {
    await page.goto(getForumUrl(kwargs), { waitUntil: 'none' });
    await page.wait(2);
    const params = buildTiebaPagePcParams(kwargs, limit);
    const cookies = await page.getCookies({ domain: 'tieba.baidu.com' });
    const cookieHeader = cookies.map((item) => `${item.name}=${item.value}`).join('; ');
    const body = new URLSearchParams({
        ...params,
        sign: signTiebaPcParams(params),
    }).toString();
    const response = await fetch('https://tieba.baidu.com/c/f/frs/page_pc', {
        method: 'POST',
        headers: {
            'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
            cookie: cookieHeader,
            'x-requested-with': 'XMLHttpRequest',
            referer: getForumUrl(kwargs),
            'user-agent': 'Mozilla/5.0',
        },
        body,
    });
    const text = await response.text();
    try {
        return JSON.parse(text);
    }
    catch {
        return {};
    }
}
cli({
    site: 'tieba',
    name: 'posts',
    access: 'read',
    description: 'Browse posts in a tieba forum',
    domain: 'tieba.baidu.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'forum', positional: true, required: true, type: 'string', help: 'Forum name in Chinese' },
        { name: 'page', type: 'int', default: 1, help: 'Page number' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of items to return' },
    ],
    columns: ['rank', 'title', 'author', 'replies'],
    func: async (page, kwargs) => {
        const limit = normalizeTiebaLimit(kwargs.limit);
        const payload = await fetchTiebaPagePc(page, kwargs, limit);
        const rawFeeds = Array.isArray(payload.page_data?.feed_list) ? payload.page_data.feed_list : [];
        const rawCards = buildTiebaPostCardsFromPagePc(rawFeeds);
        const items = buildTiebaPostItems(rawCards, limit);
        if (!items.length || payload.error_code) {
            throw new EmptyResultError('tieba posts', 'Tieba may have blocked the forum page, or the DOM structure may have changed');
        }
        return items;
    },
});
