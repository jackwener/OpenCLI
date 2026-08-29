/**
 * Shared helpers for the Xiaohongshu 收藏 (collection) adapters:
 * collect / collect-boards / collect-board.
 *
 * All edith.xiaohongshu.com endpoints require an x-s signature, so a raw
 * fetch() fails with "create invalid signature". The browser-driving helpers
 * here let the page fire its own signed requests, which the adapters read back
 * via the interceptor. The pure mapping/parsing helpers are unit-tested in
 * collect-helpers.test.js.
 */
import { AuthRequiredError } from '@jackwener/opencli/errors';

export function toStr(value) {
    return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

export function normalizeXhsUserId(input) {
    const trimmed = toStr(input);
    const withoutQuery = trimmed.replace(/[?#].*$/, '');
    const matched = withoutQuery.match(/\/user\/profile\/([a-zA-Z0-9]+)/);
    if (matched?.[1])
        return matched[1];
    return withoutQuery.replace(/\/+$/, '').split('/').pop() ?? withoutQuery;
}

export function normalizeBoardId(input) {
    const trimmed = toStr(input);
    const matched = trimmed.match(/\/board\/([0-9a-f]{24})/);
    if (matched?.[1])
        return matched[1];
    return trimmed.replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() ?? trimmed;
}

// A 24-char hex string is a raw XHS object id (board id / note id).
export function looksLikeId(value) {
    return /^[0-9a-f]{24}$/.test(toStr(value));
}

export function buildExploreUrl(noteId, xsecToken) {
    const id = toStr(noteId);
    if (!id)
        return '';
    const url = new URL(`https://www.xiaohongshu.com/explore/${id}`);
    const token = toStr(xsecToken);
    if (token) {
        url.searchParams.set('xsec_token', token);
        url.searchParams.set('xsec_source', 'pc_user');
    }
    return url.toString();
}

// Intercepted payloads may be the full body ({code,data:{...}}) or the already
// unwrapped data object; return the inner data either way.
export function unwrap(payload) {
    return payload?.data ?? payload ?? {};
}

// Map a raw board object from GET /api/sns/web/v1/board/user.
export function mapBoard(board) {
    return {
        id: toStr(board?.id),
        name: toStr(board?.name),
        count: Number(board?.total ?? 0) || 0,
        privacy: toStr(board?.privacy),
        desc: toStr(board?.desc),
    };
}

// Map a raw note object from board/note, note/collect/page (snake_case API), or
// the SSR-hydrated store (camelCase). Handle all three shapes. Returns null when
// the note has no id.
export function mapCollectedNote(note) {
    const id = toStr(note?.note_id ?? note?.noteId ?? note?.id);
    if (!id)
        return null;
    const interact = note?.interact_info ?? note?.interactInfo ?? {};
    const user = note?.user ?? {};
    return {
        id,
        title: toStr(note?.display_title ?? note?.displayTitle ?? note?.title),
        author: toStr(user.nickname ?? user.nick_name ?? user.nickName),
        type: toStr(note?.type),
        likes: toStr(interact.liked_count ?? interact.likedCount ?? '0') || '0',
        url: buildExploreUrl(id, note?.xsec_token ?? note?.xsecToken),
    };
}

// Pick a board out of a list by 24-hex id or by (case-insensitive) name, exact
// match preferred over substring. Returns the matched board, a bare {id} stub
// when an unknown id is given, or null when a name matches nothing.
export function matchBoard(boards, boardArg) {
    const list = Array.isArray(boards) ? boards : [];
    const raw = normalizeBoardId(boardArg);
    if (looksLikeId(raw)) {
        return list.find((b) => b.id === raw) ?? { id: raw, name: '' };
    }
    const wanted = toStr(boardArg).toLowerCase();
    return (list.find((b) => b.name.toLowerCase() === wanted)
        ?? list.find((b) => b.name.toLowerCase().includes(wanted))
        ?? null);
}

async function readMe(page) {
    return await page.evaluate(`
        (() => {
            const u = window.__INITIAL_STATE__?.user || {};
            const g = (x) => (x && x._value !== undefined ? x._value : x);
            const me = g(u.userInfo) || {};
            return { loggedIn: g(u.loggedIn) === true, userId: me.userId || '', guest: me.guest === true };
        })()
    `);
}

export async function resolveLoggedInUserId(page) {
    let info = await readMe(page);
    // The home/explore SSR may render the visitor as a guest even when the
    // session cookie is valid; the own-profile route reliably hydrates userInfo.
    if (!info || info.guest || !info.userId || !info.loggedIn) {
        await page.goto('https://www.xiaohongshu.com/user/profile/');
        await page.wait(2);
        info = await readMe(page);
    }
    if (!info || info.guest || !info.userId || !info.loggedIn) {
        throw new AuthRequiredError('www.xiaohongshu.com', 'Not logged in. Open www.xiaohongshu.com in Chrome and sign in first.');
    }
    return info.userId;
}

/**
 * Drive profile → 收藏 → 专辑 and intercept the board list, returning mapped
 * boards. Leaves the page on the 专辑 list so callers can SPA-click a card.
 */
export async function fetchBoards(page, userId) {
    await page.goto(`https://www.xiaohongshu.com/user/profile/${userId}`);
    await page.wait(2);
    await page.installInterceptor('board/user');
    // Click 收藏 (main tab), then 专辑 (sub-tab, label carries a "·N" count).
    await page.evaluate(`
        (() => {
            const t = [...document.querySelectorAll('.reds-tab-item.sub-tab-list')]
                .find((el) => el.textContent.trim() === '收藏');
            if (t) t.click();
        })()
    `);
    await page.wait(2);
    await page.evaluate(`
        (() => {
            const b = [...document.querySelectorAll('.reds-tab-item')]
                .find((el) => el.textContent.trim().startsWith('专辑'));
            if (b) b.click();
        })()
    `);
    await page.waitForCapture(6);
    const boards = [];
    const seen = new Set();
    // Board lists are small (paginated 30/page); a few scrolls covers accounts
    // with many albums.
    const maxScrolls = 4;
    for (let i = 0; i <= maxScrolls; i++) {
        const requests = await page.getInterceptedRequests();
        const before = boards.length;
        for (const req of Array.isArray(requests) ? requests : []) {
            const list = unwrap(req?.data)?.boards;
            for (const raw of Array.isArray(list) ? list : []) {
                const b = mapBoard(raw);
                if (!b.id || seen.has(b.id))
                    continue;
                seen.add(b.id);
                boards.push(b);
            }
        }
        if (i === maxScrolls || (i > 0 && boards.length === before))
            break;
        await page.autoScroll({ times: 1, delayMs: 1500 });
        await page.wait(1);
    }
    return boards;
}
