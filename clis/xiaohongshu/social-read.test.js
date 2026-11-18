import { afterEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { command as profile, PROFILE_SNAPSHOT_JS, projectUserProfile } from './user-profile.js';
import { NOTE_EXTRACT_JS, command as note } from './note.js';
import { PROFILE_COLUMNS, publicCount } from '../_shared/social-profile.js';
const id = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const postId = 'cccccccccccccccccccccccc';
const url = `https://www.xiaohongshu.com/user/profile/${id}`;
const snapshot = () => ({
    observedUrl: url, modelTarget: id, loginWall: false, followLabel: '已关注', noteGroups: [],
    pageData: { basicInfo: { nickname: 'Synthetic', desc: 'Public description', ipLocation: 'Example province' }, interactions: [{ type: 'fans', count: '12' }, { type: 'follows', count: '1.2万' }], posted: 0 },
});
afterEach(() => { vi.restoreAllMocks(); });

describe('xiaohongshu ordinary user profile', () => {
    it('returns a public profile with exact target and nullable unverified fields', () => {
        const row = projectUserProfile(snapshot(), id, 5);
        expect(Object.keys(row)).toEqual(PROFILE_COLUMNS);
        expect(row).toMatchObject({ user_id: id, follower_count: 12, following_count: 12000, post_count: null, follow_status: 'following', posts: [] });
    });
    it('rejects model mismatch, navigation drift, auth failure and malformed counts', () => {
        expect(() => projectUserProfile({ ...snapshot(), modelTarget: postId }, id, 5)).toThrow('identity');
        expect(() => projectUserProfile({ ...snapshot(), observedUrl: 'https://evil.example/' }, id, 5)).toThrow('navigated');
        expect(() => projectUserProfile({ ...snapshot(), loginWall: true }, id, 5)).toThrow('Not logged');
        expect(() => publicCount('followers:12', 'test')).toThrow('invalid');
    });
    it('executes the actual snapshot against synthetic Pinia data and DOM', () => {
        const dom = new JSDOM('<div id="app"></div><div class="user-info"><button>已关注</button></div>', { url, runScripts: 'outside-only' });
        dom.window.__INITIAL_STATE__ = { user: { notes: [], userPageData: snapshot().pageData, loggedIn: true } };
        dom.window.document.querySelector('#app').__vue_app__ = { config: { globalProperties: { $pinia: { _s: new Map([['user', { visitTargetUserId: id }]]) } } } };
        dom.window.document.querySelector('button').getBoundingClientRect = () => ({ width: 100 });
        const result = dom.window.eval(PROFILE_SNAPSHOT_JS);
        expect(projectUserProfile(result, id, 5)).toMatchObject({ user_id: id, follow_status: 'following' });
        dom.window.close();
    });
    it('validates arguments before browser navigation and waits for hydration', async () => {
        const page = { goto: vi.fn(), wait: vi.fn(), evaluate: vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce(snapshot()) };
        const rows = await profile.func(page, { target: id });
        expect(rows).toHaveLength(1);
        expect(page.wait).toHaveBeenCalledTimes(1);
        expect(() => profile.validateArgs({ target: 'nickname' })).toThrow();
        expect(() => profile.validateArgs({ target: id, limit: 21 })).toThrow('--limit');
    });
});

describe('xiaohongshu note author identity', () => {
    it('takes the author from the note header, never a commenter or recommended post', () => {
        const dom = new JSDOM(`<div id="noteContainer"><div class="author-wrapper"><a href="/user/profile/${id}"><span class="username">Synthetic</span></a></div><div class="comments"><a href="/user/profile/${postId}">Commenter</a></div></div>`, { url: `https://www.xiaohongshu.com/explore/${postId}?xsec_token=test`, runScripts: 'outside-only' });
        expect(dom.window.eval(NOTE_EXTRACT_JS).authorUrl).toBe(url);
        dom.window.close();
    });
    it('exports stable author identity without changing the field/value format', async () => {
        const page = {
            goto: vi.fn(),
            wait: vi.fn(),
            evaluate: vi.fn().mockResolvedValue({
                pageUrl: `https://www.xiaohongshu.com/explore/${postId}?xsec_token=test`,
                title: 'Synthetic',
                author: 'Synthetic',
                authorUrl: url,
                likes: '1',
                likesPresent: true,
                collects: '0',
                comments: '0',
            }),
        };
        const rows = await note.func(page, { 'note-id': `https://www.xiaohongshu.com/explore/${postId}?xsec_token=test` });
        expect(rows).toContainEqual({ field: 'author_id', value: id });
        expect(rows).toContainEqual({ field: 'author_url', value: url });
    });
    it('keeps author identity when the header hydrates only after the counts are polled', async () => {
        const pageUrl = `https://www.xiaohongshu.com/explore/${postId}?xsec_token=test`;
        const page = {
            goto: vi.fn(),
            wait: vi.fn(),
            evaluate: vi
                .fn()
                // First read: interaction bar still empty, author link not rendered yet.
                .mockResolvedValueOnce({ pageUrl, title: 'Synthetic', author: 'Synthetic', authorUrl: null })
                .mockResolvedValueOnce({ pageUrl, title: 'Synthetic', author: 'Synthetic', authorUrl: url, likes: '1', likesPresent: true, collects: '0', comments: '0' }),
        };
        const rows = await note.func(page, { 'note-id': pageUrl });
        expect(page.evaluate).toHaveBeenCalledTimes(2);
        expect(rows).toContainEqual({ field: 'author_id', value: id });
        expect(rows).toContainEqual({ field: 'author_url', value: url });
    });
});
