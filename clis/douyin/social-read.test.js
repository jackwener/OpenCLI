import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { command as profile, parsePublicSecUid, PROFILE_SNAPSHOT_JS, projectUserProfile } from './user-profile.js';
import { command as nearby } from './nearby.js';
import { PROFILE_COLUMNS } from '../_shared/social-profile.js';
const secUid = 'MS4wLjABAAAASyntheticPeer001';
const url = `https://www.douyin.com/user/${secUid}`;
const snapshot = () => ({ observedUrl: url, followLabel: '相互关注', info: { uid: '200', secUid, nickname: 'Synthetic', desc: 'Public bio', followerCount: 1, followingCount: 2, totalFavorited: 3, awemeCount: 0 } });

describe('douyin ordinary public profile', () => {
    it('accepts only exact trusted URLs or valid sec_uids', () => {
        expect(parsePublicSecUid(secUid)).toBe(secUid);
        expect(parsePublicSecUid(url)).toBe(secUid);
        for (const value of ['200', 'nickname', `https://evil.example/user/${secUid}`, `https://www.douyin.com.evil.example/user/${secUid}`, `https://www.douyin.com/user/${secUid}/extra`]) expect(() => parsePublicSecUid(value)).toThrow();
    });
    it('returns numeric UID and public profile fields with nullable unknown metadata', () => {
        const row = projectUserProfile(snapshot(), secUid);
        expect(Object.keys(row)).toEqual(PROFILE_COLUMNS);
        expect(row).toMatchObject({ user_id: '200', sec_uid: secUid, follow_status: 'mutual', post_count: 0, ip_location: null });
    });
    it('rejects the logged-in account model when it differs from the requested author', () => {
        expect(() => projectUserProfile({ ...snapshot(), info: { ...snapshot().info, secUid: 'MS4wLjABAAAAOtherUser01' } }, secUid)).toThrow('identity');
        expect(() => projectUserProfile({ ...snapshot(), observedUrl: 'https://www.douyin.com/' }, secUid)).toThrow('navigated');
    });
    it('executes the real Fiber snapshot against a synthetic component model', () => {
        const dom = new JSDOM('<button data-e2e="user-info-follow-btn">相互关注</button>', { url, runScripts: 'outside-only' });
        const button = dom.window.document.querySelector('button');
        button.getBoundingClientRect = () => ({ width: 100 });
        button.__reactFiber$fixture = { memoizedProps: {}, return: { memoizedProps: { userInfo: snapshot().info } } };
        expect(projectUserProfile(dom.window.eval(PROFILE_SNAPSHOT_JS), secUid)).toMatchObject({ user_id: '200', follow_status: 'mutual' });
        dom.window.close();
    });
    it('returns an empty public-post list for a valid zero-post profile', async () => {
        const page = { goto: vi.fn(), wait: vi.fn(), evaluate: vi.fn().mockResolvedValue(snapshot()) };
        expect((await profile.func(page, { target: secUid }))[0].posts).toEqual([]);
        expect(page.evaluate).toHaveBeenCalledTimes(1);
    });
});

describe('douyin Web-only nearby capability', () => {
    it('reports unavailable explicitly instead of returning city keyword results', async () => {
        expect(nearby.browser).toBe(false);
        await expect(nearby.func({})).rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('no nearby data source has been verified') });
    });
});
