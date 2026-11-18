import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, TimeoutError } from '@jackwener/opencli/errors';
import { __test__, collectFollowingFromCapture, mapXhsFollowing, parseLimit } from './user-following.js';

const selfId = '68c89a50000000001901a64d';
const otherId = '566cd048b8ce1a0981cb1846';

function imEntry(page, list) {
    return {
        kind: 'cdp',
        url: `https://edith.xiaohongshu.com/api/im/web/users/following/all?page=${page}&size=200`,
        method: 'GET',
        responseStatus: 200,
        responsePreview: JSON.stringify({ code: 0, success: true, msg: '成功', data: { follow_user_d_t_o_list: list } }),
    };
}

function rawFollowing(id, nick = 'n') {
    return { verify_type: 0, limit_msg_status: 0, user_id: id, nick_name: nick, avatar: 'https://sns-avatar-qc.xhscdn.com/avatar/a?imageView2/2/w/80/format/jpg', status: 2 };
}

function makePage({ self = { loggedOut: false, userId: selfId, guest: false }, captures = [] } = {}) {
    const evaluate = vi.fn().mockResolvedValue(self);
    const readNetworkCapture = vi.fn();
    for (const batch of captures) readNetworkCapture.mockResolvedValueOnce(batch);
    readNetworkCapture.mockResolvedValue([]);
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate,
        startNetworkCapture: vi.fn().mockResolvedValue(true),
        readNetworkCapture,
    };
}

describe('xiaohongshu user-following', () => {
    it('maps IM entries with null desc / fans (the IM payload has neither)', () => {
        expect(mapXhsFollowing(rawFollowing(otherId, '老鬼'))).toEqual({
            user_id: otherId,
            nickname: '老鬼',
            desc: null,
            fans: null,
            avatar: 'https://sns-avatar-qc.xhscdn.com/avatar/a?imageView2/2/w/80/format/jpg',
            url: `https://www.xiaohongshu.com/user/profile/${otherId}`,
        });
        expect(mapXhsFollowing({})).toBeNull();
    });

    it('collects pages once, dedupes users and marks completion on the empty page', () => {
        const acc = new Map();
        const seen = new Set();
        const first = collectFollowingFromCapture([imEntry(1, [rawFollowing('a'.repeat(24)), rawFollowing('b'.repeat(24))])], seen, acc);
        expect(first.rows).toHaveLength(2);
        expect(first.complete).toBe(false);
        const again = collectFollowingFromCapture([imEntry(1, [rawFollowing('a'.repeat(24))]), imEntry(2, [])], seen, acc);
        expect(again.rows).toHaveLength(2);
        expect(again.complete).toBe(true);
        // Non-matching / malformed entries are ignored.
        expect(collectFollowingFromCapture([{ url: 'https://x/other' }, { url: imEntry(3, []).url, responsePreview: 'not json' }], seen, acc).complete).toBe(false);
    });

    it('parses --limit within bounds', () => {
        expect(parseLimit(undefined)).toBe(200);
        expect(parseLimit(5)).toBe(5);
        expect(() => parseLimit(0)).toThrow(ArgumentError);
        expect(() => parseLimit(99999)).toThrow(ArgumentError);
    });

    it('returns the own list when no user id is given, via extension network capture', async () => {
        const command = getRegistry().get('xiaohongshu/user-following');
        const page = makePage({ captures: [[imEntry(1, [rawFollowing('a'.repeat(24), 'A')])], [imEntry(2, [])]] });
        const rows = await command.func(page, { limit: 200 });
        expect(rows).toEqual([expect.objectContaining({ user_id: 'a'.repeat(24), nickname: 'A' })]);
        expect(page.startNetworkCapture).toHaveBeenCalledWith(__test__.IM_FOLLOWING_PATH);
        expect(page.goto).toHaveBeenLastCalledWith(`https://www.xiaohongshu.com/user/profile/${selfId}`);
    });

    it('treats the logged-in user id like the no-argument form and honours --limit', async () => {
        const command = getRegistry().get('xiaohongshu/user-following');
        const page = makePage({ captures: [[imEntry(1, [rawFollowing('a'.repeat(24)), rawFollowing('b'.repeat(24)), rawFollowing('c'.repeat(24))])]] });
        const rows = await command.func(page, { 'user-id': selfId, limit: 2 });
        expect(rows).toHaveLength(2);
    });

    it('rejects any other user id before starting capture (xhs web has no endpoint)', async () => {
        const command = getRegistry().get('xiaohongshu/user-following');
        const page = makePage();
        await expect(command.func(page, { 'user-id': otherId, limit: 200 })).rejects.toThrow(ArgumentError);
        expect(page.startNetworkCapture).not.toHaveBeenCalled();
    });

    it('maps a logged-out session to AuthRequiredError', async () => {
        const command = getRegistry().get('xiaohongshu/user-following');
        const page = makePage({ self: { loggedOut: true, userId: '', guest: false } });
        await expect(command.func(page, { limit: 10 })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('fails with TimeoutError when the page never issues the IM request', async () => {
        const command = getRegistry().get('xiaohongshu/user-following');
        const page = makePage();
        const realNow = Date.now;
        let now = 1_000_000;
        vi.spyOn(Date, 'now').mockImplementation(() => { now += 7_000; return now; });
        try {
            await expect(command.func(page, { limit: 10 })).rejects.toBeInstanceOf(TimeoutError);
        } finally {
            Date.now = realNow;
        }
    });

    it('requires extension network capture support', async () => {
        const command = getRegistry().get('xiaohongshu/user-following');
        const page = makePage();
        page.startNetworkCapture = vi.fn().mockResolvedValue(false);
        await expect(command.func(page, { limit: 10 })).rejects.toBeInstanceOf(CommandExecutionError);
        const bare = makePage();
        delete bare.startNetworkCapture;
        await expect(command.func(bare, { limit: 10 })).rejects.toThrowError(/network capture/);
    });
});
