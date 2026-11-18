import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { fetchXhsUserInfo, hasUserPageData, mapXhsUserInfo, USER_INFO_SNAPSHOT_JS, XHS_USER_INFO_COLUMNS } from './user-info.js';

const userId = '566cd048b8ce1a0981cb1846';

/** userPageData as the profile page's Pinia `user` store exposes it. */
function pageData(overrides = {}) {
    return {
        basicInfo: {
            desc: '📍深圳20年品牌全案实战顾问\n只做可变现的商业品牌',
            gender: 0,
            imageb: 'https://sns-avatar-qc.xhscdn.com/avatar/x?imageView2/2/w/540/format/webp',
            images: 'https://sns-avatar-qc.xhscdn.com/avatar/x?imageView2/2/w/360/format/webp',
            ipLocation: '广东',
            nickname: '老鬼',
            redId: 'w30230110',
        },
        extraInfo: { blockType: 'DEFAULT', fstatus: 'none' },
        interactions: [
            { count: '209', i18nCount: '209', name: '关注', type: 'follows' },
            { count: '581', i18nCount: '581', name: '粉丝', type: 'fans' },
            { count: '9776', i18nCount: '9.8K', name: '获赞与收藏', type: 'interaction' },
        ],
        result: { code: 0, message: 'success', success: true },
        ...overrides,
    };
}

function snapshot(overrides = {}) {
    return { storePresent: true, pageData: pageData(), fetchingStatus: 'resolved', loginWall: false, pathName: `/user/profile/${userId}`, ...overrides };
}

function makePage(evaluateResults = []) {
    const evaluate = vi.fn();
    for (const r of evaluateResults) evaluate.mockResolvedValueOnce(r);
    evaluate.mockResolvedValue(undefined);
    return { goto: vi.fn().mockResolvedValue(undefined), wait: vi.fn().mockResolvedValue(undefined), evaluate };
}

describe('xiaohongshu user-info', () => {
    it('maps the profile store into the documented row with numeric counts', () => {
        expect(mapXhsUserInfo(pageData(), userId)).toEqual({
            user_id: userId,
            nickname: '老鬼',
            red_id: 'w30230110',
            desc: '📍深圳20年品牌全案实战顾问\n只做可变现的商业品牌',
            fans: 581,
            follows: 209,
            likes_collects: 9776,
            notes_count: null,
            following: false,
            follow_status: 'none',
            ip_location: '广东',
            avatar: 'https://sns-avatar-qc.xhscdn.com/avatar/x?imageView2/2/w/540/format/webp',
            url: `https://www.xiaohongshu.com/user/profile/${userId}`,
        });
    });

    it('declares every emitted key in columns', () => {
        expect(Object.keys(mapXhsUserInfo(pageData(), userId)).sort()).toEqual([...XHS_USER_INFO_COLUMNS].sort());
    });

    it('reports following=true for follows / both and null when fstatus is absent', () => {
        expect(mapXhsUserInfo(pageData({ extraInfo: { fstatus: 'follows' } }), userId).following).toBe(true);
        expect(mapXhsUserInfo(pageData({ extraInfo: { fstatus: 'both' } }), userId).following).toBe(true);
        expect(mapXhsUserInfo(pageData({ extraInfo: { fstatus: 'fans' } }), userId).following).toBe(false);
        expect(mapXhsUserInfo(pageData({ extraInfo: {} }), userId)).toMatchObject({ following: null, follow_status: null });
    });

    it('emits null for missing optional fields and parses 万 counts', () => {
        const row = mapXhsUserInfo(pageData({
            basicInfo: { nickname: 'x', desc: '', redId: '', images: '' },
            interactions: [{ type: 'fans', count: '1.2万' }],
        }), userId);
        expect(row).toMatchObject({ desc: null, red_id: null, avatar: null, ip_location: null, fans: 12000, follows: null, likes_collects: null });
    });

    it('rejects snapshots without basicInfo', () => {
        expect(() => mapXhsUserInfo({}, userId)).toThrow(CommandExecutionError);
        expect(hasUserPageData(snapshot())).toBe(true);
        expect(hasUserPageData(snapshot({ pageData: {} }))).toBe(false);
    });

    it('fetchXhsUserInfo navigates, reads the store and maps', async () => {
        const page = makePage([snapshot()]);
        const row = await fetchXhsUserInfo(page, userId);
        expect(page.goto).toHaveBeenCalledWith(`https://www.xiaohongshu.com/user/profile/${userId}`);
        expect(row.nickname).toBe('老鬼');
        expect(page.wait).not.toHaveBeenCalled();
    });

    it('retries while the store is still hydrating and unwraps bridge envelopes', async () => {
        const page = makePage([
            { session: 's', data: snapshot({ pageData: {} }) },
            { session: 's', data: snapshot({ pageData: {} }) },
            { session: 's', data: snapshot() },
        ]);
        const row = await fetchXhsUserInfo(page, userId);
        expect(row.fans).toBe(581);
        expect(page.wait).toHaveBeenCalledTimes(2);
    });

    it('maps login walls to AuthRequiredError without waiting out the retries', async () => {
        const page = makePage([snapshot({ pageData: {}, loginWall: true })]);
        await expect(fetchXhsUserInfo(page, userId)).rejects.toBeInstanceOf(AuthRequiredError);
        expect(page.wait).not.toHaveBeenCalled();
    });

    it('maps rejected / missing profiles to EmptyResultError', async () => {
        const page = makePage([snapshot({ pageData: { result: { code: 300031, message: '用户不存在' } }, fetchingStatus: 'rejected' })]);
        await expect(fetchXhsUserInfo(page, userId)).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('surfaces a missing store as CommandExecutionError after retries', async () => {
        const page = makePage(Array.from({ length: 9 }, () => snapshot({ storePresent: false, pageData: null })));
        await expect(fetchXhsUserInfo(page, userId)).rejects.toThrowError(/user store was not found/);
    });

    it('registers the command with positional user-id validation', async () => {
        const command = getRegistry().get('xiaohongshu/user-info');
        expect(command.columns).toEqual(XHS_USER_INFO_COLUMNS);
        await expect(command.func(makePage(), { 'user-id': 'nope' })).rejects.toBeInstanceOf(ArgumentError);
        const page = makePage([snapshot()]);
        await expect(command.func(page, { 'user-id': `https://www.xiaohongshu.com/user/profile/${userId}` })).resolves.toHaveLength(1);
    });

    it('snapshot script is a valid expression that reads the Pinia user store', () => {
        expect(USER_INFO_SNAPSHOT_JS).toContain("__xhsStore('user')");
        expect(() => new Function(`return (${USER_INFO_SNAPSHOT_JS});`)).not.toThrow();
    });
});
