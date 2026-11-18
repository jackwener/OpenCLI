import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CliError, CommandExecutionError, EmptyResultError, TimeoutError } from '@jackwener/opencli/errors';
import { buildUserSearchJs, mapXhsSearchUser, searchXhsUsers, XHS_USER_SEARCH_COLUMNS } from './user-search.js';
import './search.js';

/** One entry exactly as `search.userLists` exposes it (camelCase, counts as strings). */
function rawUser(overrides = {}) {
    return {
        id: '5c17bfc3000000000602b7f8',
        name: '机器学习我休息',
        redId: '533016842',
        image: 'https://sns-avatar-qc.xhscdn.com/avatar/abc?imageView2/2/w/360/format/webp',
        fans: '39',
        noteCount: 68,
        subTitle: '小红书号：533016842',
        followed: false,
        xsecToken: 'ABZ3',
        ...overrides,
    };
}

function makePage(evaluateResults = []) {
    const evaluate = vi.fn();
    for (const r of evaluateResults) evaluate.mockResolvedValueOnce(r);
    evaluate.mockResolvedValue(undefined);
    return { goto: vi.fn().mockResolvedValue(undefined), wait: vi.fn().mockResolvedValue(undefined), evaluate };
}

describe('xiaohongshu user search', () => {
    describe('mapXhsSearchUser', () => {
        it('maps the store entry into the documented row with numeric counts', () => {
            expect(mapXhsSearchUser(rawUser(), 0)).toEqual({
                rank: 1,
                title: '机器学习我休息',
                user_id: '5c17bfc3000000000602b7f8',
                nickname: '机器学习我休息',
                red_id: '533016842',
                avatar: 'https://sns-avatar-qc.xhscdn.com/avatar/abc?imageView2/2/w/360/format/webp',
                desc: null,
                fans: 39,
                notes_count: 68,
                followed: false,
                url: 'https://www.xiaohongshu.com/user/profile/5c17bfc3000000000602b7f8',
            });
        });

        it('keeps a real bio as desc but drops the 小红书号 placeholder', () => {
            expect(mapXhsSearchUser(rawUser({ subTitle: '每天一个 ML 小知识' }), 0).desc).toBe('每天一个 ML 小知识');
            expect(mapXhsSearchUser(rawUser({ subTitle: '小红书号:1' }), 0).desc).toBeNull();
        });

        it('parses 万 counts and emits null for missing numbers', () => {
            const row = mapXhsSearchUser(rawUser({ fans: '1.2万', noteCount: undefined, redId: '' }), 4);
            expect(row.rank).toBe(5);
            expect(row.fans).toBe(12000);
            expect(row.notes_count).toBeNull();
            expect(row.red_id).toBeNull();
        });

        it('returns null for entries without an id', () => {
            expect(mapXhsSearchUser({ name: 'x' }, 0)).toBeNull();
            expect(mapXhsSearchUser(null, 0)).toBeNull();
        });

        it('declares every emitted key in the exported column list', () => {
            const row = mapXhsSearchUser(rawUser(), 0);
            expect(Object.keys(row).sort()).toEqual([...XHS_USER_SEARCH_COLUMNS].sort());
        });
    });

    describe('buildUserSearchJs', () => {
        it('drives search.getUserLists / loadMoreUsers with the keyword baked in', () => {
            const js = buildUserSearchJs('机器学习', 25);
            expect(js).toContain("__xhsStore('search')");
            expect(js).toContain('store.getUserLists(searchId)');
            expect(js).toContain('store.loadMoreUsers()');
            expect(js).toContain(JSON.stringify('机器学习'));
            expect(js).toContain('const limit = 25;');
            expect(() => new Function(`return (${js});`)).not.toThrow();
        });

        it('rejects empty keywords and bad limits', () => {
            expect(() => buildUserSearchJs('', 10)).toThrow(ArgumentError);
            expect(() => buildUserSearchJs('x', 0)).toThrow(ArgumentError);
        });
    });

    describe('searchXhsUsers', () => {
        it('navigates to the search page, waits for the store and maps rows', async () => {
            const page = makePage(['ready', { status: 'success', error: null, securityBlock: false, loginWall: false, users: [rawUser(), rawUser({ id: 'b'.repeat(24), name: 'B' })], pages: 1 }]);
            const rows = await searchXhsUsers(page, '机器学习', 2);
            expect(page.goto).toHaveBeenCalledWith('https://www.xiaohongshu.com/search_result?keyword=%E6%9C%BA%E5%99%A8%E5%AD%A6%E4%B9%A0&source=web_explore_feed');
            expect(rows).toHaveLength(2);
            expect(rows[1]).toMatchObject({ rank: 2, user_id: 'b'.repeat(24), nickname: 'B' });
        });

        it('unwraps bridge envelopes', async () => {
            const page = makePage([
                { session: 's', data: 'ready' },
                { session: 's', data: { status: 'success', users: [rawUser()] } },
            ]);
            const rows = await searchXhsUsers(page, 'q', 5);
            expect(rows).toHaveLength(1);
        });

        it('throws TimeoutError when the store never appears', async () => {
            const page = makePage(['timeout']);
            await expect(searchXhsUsers(page, 'q', 5)).rejects.toBeInstanceOf(TimeoutError);
        });

        it('maps login walls to AuthRequiredError', async () => {
            const page = makePage(['ready', { status: 'login_wall' }]);
            await expect(searchXhsUsers(page, 'q', 5)).rejects.toBeInstanceOf(AuthRequiredError);
        });

        it('maps a missing store / action to CommandExecutionError', async () => {
            const page = makePage(['ready', { status: 'no_action' }]);
            await expect(searchXhsUsers(page, 'q', 5)).rejects.toThrowError(/store is unavailable \(no_action\)/);
        });

        it('maps security blocks to SECURITY_BLOCK', async () => {
            const page = makePage(['ready', { status: 'error', securityBlock: true, users: [] }]);
            await expect(searchXhsUsers(page, 'q', 5)).rejects.toMatchObject({ code: 'SECURITY_BLOCK' });
        });

        it('surfaces API errors and empty results', async () => {
            const page1 = makePage(['ready', { status: 'error', error: 'HTTP 461', users: [] }]);
            await expect(searchXhsUsers(page1, 'q', 5)).rejects.toThrowError(/HTTP 461/);
            const page2 = makePage(['ready', { status: 'success', users: [] }]);
            await expect(searchXhsUsers(page2, 'q', 5)).rejects.toBeInstanceOf(EmptyResultError);
            const page3 = makePage(['ready', 'nonsense']);
            await expect(searchXhsUsers(page3, 'q', 5)).rejects.toBeInstanceOf(CommandExecutionError);
        });
    });

    describe('search --type user wiring', () => {
        it('routes --type user to the user search path and leaves notes untouched by default', async () => {
            const command = getRegistry().get('xiaohongshu/search');
            expect(command.args.find((a) => a.name === 'type')).toMatchObject({ default: 'notes', choices: ['notes', 'user'] });
            const page = makePage(['ready', { status: 'success', users: [rawUser()] }]);
            const rows = await command.func(page, { query: '机器学习', type: 'user', limit: 5 });
            expect(rows[0]).toMatchObject({ user_id: '5c17bfc3000000000602b7f8', fans: 39 });
            expect(String(page.goto.mock.calls[0][0])).toContain('search_result?keyword=');
        });

        it('declares both row shapes in columns so table output drops nothing', () => {
            const command = getRegistry().get('xiaohongshu/search');
            const columns = new Set(command.columns);
            // Note rows and user rows both flow through this one command.
            for (const key of ['rank', 'title', 'author', 'likes', 'published_at', 'url']) {
                expect(columns.has(key), `note column ${key}`).toBe(true);
            }
            for (const key of XHS_USER_SEARCH_COLUMNS) {
                expect(columns.has(key), `user column ${key}`).toBe(true);
            }
            expect(command.columns.length).toBe(new Set(command.columns).size);
        });

        it('rejects unknown --type values before navigating', async () => {
            const command = getRegistry().get('xiaohongshu/search');
            const page = makePage();
            await expect(command.func(page, { query: 'q', type: 'boards', limit: 5 })).rejects.toBeInstanceOf(CliError);
            expect(page.goto).not.toHaveBeenCalled();
        });
    });
});
