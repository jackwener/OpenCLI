import { describe, expect, it, vi } from 'vitest';
import { AuthRequiredError } from '@jackwener/opencli/errors';
import { fetchXhsCollectionNotes, resolveXhsUserId } from './collection-helpers.js';

const EXPLORE = 'https://www.xiaohongshu.com/explore';
const FAV_URL = 'https://www.xiaohongshu.com/user/profile/self-user?tab=fav&subTab=note';

const API_NOTE = {
    data: {
        notes: [{
            note_id: '662908190000000001007366',
            xsec_token: 'tok',
            note_card: {
                display_title: '收藏笔记',
                type: 'normal',
                user: { user_id: 'self-user', nickname: 'Me' },
                interact_info: { liked_count: '8' },
            },
        }],
    },
};

function dispatchPage({ uidResults = ['self-user'], loginWall = false, location, intercepted = [API_NOTE], currentUrl } = {}) {
    let uidIndex = 0;
    const page = {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        autoScroll: vi.fn().mockResolvedValue(undefined),
        installInterceptor: vi.fn().mockResolvedValue(undefined),
        getInterceptedRequests: vi.fn().mockResolvedValue(intercepted),
        evaluate: vi.fn(async (script) => {
            const s = String(script);
            if (s.includes('location.reload')) return undefined;
            if (s.includes('登录后')) return loginWall;
            if (s.includes('hostname: location.hostname')) {
                return location ?? { hostname: 'www.xiaohongshu.com', pathname: '/user/profile/self-user', href: FAV_URL };
            }
            if (s.includes('userInfo')) return uidResults[Math.min(uidIndex++, uidResults.length - 1)];
            return [];
        }),
    };
    if (currentUrl !== undefined) page.getCurrentUrl = vi.fn().mockResolvedValue(currentUrl);
    return page;
}

describe('resolveXhsUserId warm-tab staleness', () => {
    it('polls through the hydration window without reloading (reload returns before the page loads)', async () => {
        // location.reload() resolves immediately; __INITIAL_STATE__ hydrates
        // later. An empty uid right after navigation usually means "not
        // hydrated yet", never reload straight away (observed live: the
        // reload-first version raced hydration twice and failed logged-in).
        const page = dispatchPage({ uidResults: ['', '', 'self-user'] });
        await expect(resolveXhsUserId(page, '')).resolves.toBe('self-user');
        expect(page.evaluate.mock.calls.some(([s]) => String(s).includes('location.reload'))).toBe(false);
    });

    it('reloads once when polling exhausts, then polls again (stale login-state tab)', async () => {
        // initial read + 3 hydration polls all empty -> one reload -> success.
        const page = dispatchPage({ uidResults: ['', '', '', '', 'self-user'] });
        await expect(resolveXhsUserId(page, '')).resolves.toBe('self-user');
        expect(page.evaluate.mock.calls.filter(([s]) => String(s).includes('location.reload')).length).toBe(1);
    });

    it('throws AuthRequiredError only after the reload retry also exhausts its polls', async () => {
        const page = dispatchPage({ uidResults: [''] });
        await expect(resolveXhsUserId(page, '')).rejects.toBeInstanceOf(AuthRequiredError);
        expect(page.evaluate.mock.calls.filter(([s]) => String(s).includes('location.reload')).length).toBe(1);
    });

    it('forces a fresh load when the tab already sits on /explore', async () => {
        const page = dispatchPage({ currentUrl: EXPLORE });
        await expect(resolveXhsUserId(page, '')).resolves.toBe('self-user');
        expect(page.goto).not.toHaveBeenCalled();
    });
});

describe('fetchXhsCollectionNotes navigation and interceptor order', () => {
    const opts = { userId: 'self-user', profileTab: 'fav', apiPattern: '/collect', limit: 5, emptyLabel: 'saved' };

    it('installs the interceptor AFTER navigation so the page load cannot wipe the in-page patch', async () => {
        const page = dispatchPage({});
        const rows = await fetchXhsCollectionNotes(page, opts);
        expect(rows.length).toBe(1);
        const gotoOrder = page.goto.mock.invocationCallOrder[0];
        const installOrder = page.installInterceptor.mock.invocationCallOrder[0];
        expect(installOrder).toBeGreaterThan(gotoOrder);
    });

    it('forces a reload instead of a fast-pathed goto when the tab already shows this collection page', async () => {
        const page = dispatchPage({ currentUrl: FAV_URL });
        const rows = await fetchXhsCollectionNotes(page, opts);
        expect(rows.length).toBe(1);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate.mock.calls.some(([s]) => String(s).includes('location.reload'))).toBe(true);
    });
});
