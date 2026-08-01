import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { JSDOM } from 'jsdom';
import { parseNoteId, buildNoteUrl } from './note-helpers.js';
import { buildNoteExtractJs } from './note.js';
function createPageMock(evaluateResult) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(evaluateResult),
        snapshot: vi.fn().mockResolvedValue(undefined),
        click: vi.fn().mockResolvedValue(undefined),
        typeText: vi.fn().mockResolvedValue(undefined),
        pressKey: vi.fn().mockResolvedValue(undefined),
        scrollTo: vi.fn().mockResolvedValue(undefined),
        getFormState: vi.fn().mockResolvedValue({ forms: [], orphanFields: [] }),
        wait: vi.fn().mockResolvedValue(undefined),
        tabs: vi.fn().mockResolvedValue([]),
        selectTab: vi.fn().mockResolvedValue(undefined),
        networkRequests: vi.fn().mockResolvedValue([]),
        consoleMessages: vi.fn().mockResolvedValue([]),
        scroll: vi.fn().mockResolvedValue(undefined),
        autoScroll: vi.fn().mockResolvedValue(undefined),
        installInterceptor: vi.fn().mockResolvedValue(undefined),
        getInterceptedRequests: vi.fn().mockResolvedValue([]),
        getCookies: vi.fn().mockResolvedValue([]),
        screenshot: vi.fn().mockResolvedValue(''),
        waitForCapture: vi.fn().mockResolvedValue(undefined),
    };
}
describe('parseNoteId', () => {
    it('extracts ID from /explore/ URL', () => {
        expect(parseNoteId('https://www.xiaohongshu.com/explore/69c131c9000000002800be4c')).toBe('69c131c9000000002800be4c');
    });
    it('extracts ID from /search_result/ URL with query params', () => {
        expect(parseNoteId('https://www.xiaohongshu.com/search_result/69c131c9000000002800be4c?xsec_token=abc')).toBe('69c131c9000000002800be4c');
    });
    it('extracts ID from /note/ URL', () => {
        expect(parseNoteId('https://www.xiaohongshu.com/note/69c131c9000000002800be4c')).toBe('69c131c9000000002800be4c');
    });
    it('extracts ID from signed /user/profile/<user>/<note> URL', () => {
        expect(parseNoteId('https://www.xiaohongshu.com/user/profile/user123/69c131c9000000002800be4c?xsec_token=abc&xsec_source=pc_user')).toBe('69c131c9000000002800be4c');
    });
    it('returns raw string when no URL pattern matches', () => {
        expect(parseNoteId('69c131c9000000002800be4c')).toBe('69c131c9000000002800be4c');
    });
    it('trims whitespace', () => {
        expect(parseNoteId('  69c131c9000000002800be4c  ')).toBe('69c131c9000000002800be4c');
    });
});
describe('buildNoteUrl', () => {
    it('returns full URL as-is when given https URL', () => {
        const url = 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=tok';
        expect(buildNoteUrl(url)).toBe(url);
    });
    it('rejects signed URLs from non-xiaohongshu hosts', () => {
        expect(() => buildNoteUrl('https://example.com/?xsec_token=tok')).toThrow(/xiaohongshu/i);
    });
    it('rejects signed URLs with an empty xsec_token value', () => {
        expect(() => buildNoteUrl('https://www.xiaohongshu.com/search_result/69c131c9000000002800be4c?xsec_token=')).toThrow(/xsec_token|signed url/i);
    });
    it('rejects bare note IDs because xiaohongshu now requires a signed URL', () => {
        expect(() => buildNoteUrl('abc123')).toThrow(/xsec_token|signed url/i);
    });
});
describe('xiaohongshu note', () => {
    const command = getRegistry().get('xiaohongshu/note');
    it('is registered', () => {
        expect(command).toBeDefined();
        expect(command.func).toBeTypeOf('function');
    });
    it('returns note content as field/value rows for signed full URLs', async () => {
        const page = createPageMock({
            loginWall: false,
            notFound: false,
            title: '尚界Z7实车体验',
            desc: '今天去看了实车，外观很帅',
            author: '小红薯用户',
            id: '69c131c9000000002800be4c',
            url: 'https://www.xiaohongshu.com/explore/69c131c9000000002800be4c',
            author_id: 'author-123',
            author_url: 'https://www.xiaohongshu.com/user/profile/author-123',
            published_at: '2026-03-18T12:01:00.000Z',
            published_at_source: 'initial_state',
            likes: '257',
            collects: '98',
            comments: '45',
            tags: ['#尚界Z7', '#鸿蒙智行'],
            media: [
                { type: 'image', url: 'https://sns-img-bd.xhscdn.com/cover.jpg' },
                { type: 'image', url: 'https://sns-img-bd.xhscdn.com/second.jpg' },
            ],
        });
        const signedUrl = 'https://www.xiaohongshu.com/search_result/69c131c9000000002800be4c?xsec_token=abc';
        const result = (await command.func(page, { 'note-id': signedUrl }));
        expect(page.goto.mock.calls[0][0]).toBe(signedUrl);
        expect(result).toEqual([
            { field: 'id', value: '69c131c9000000002800be4c' },
            { field: 'url', value: 'https://www.xiaohongshu.com/explore/69c131c9000000002800be4c' },
            { field: 'title', value: '尚界Z7实车体验' },
            { field: 'author', value: '小红薯用户' },
            { field: 'author_id', value: 'author-123' },
            { field: 'author_url', value: 'https://www.xiaohongshu.com/user/profile/author-123' },
            { field: 'published_at', value: '2026-03-18T12:01:00.000Z' },
            { field: 'published_at_source', value: 'initial_state' },
            { field: 'content', value: '今天去看了实车，外观很帅' },
            { field: 'likes', value: '257' },
            { field: 'collects', value: '98' },
            { field: 'comments', value: '45' },
            { field: 'media', value: [
                    { type: 'image', url: 'https://sns-img-bd.xhscdn.com/cover.jpg' },
                    { type: 'image', url: 'https://sns-img-bd.xhscdn.com/second.jpg' },
                ] },
            { field: 'tags', value: '#尚界Z7, #鸿蒙智行' },
        ]);
    });
    it('rejects bare note IDs before browser navigation', async () => {
        const page = createPageMock({
            loginWall: false, notFound: false,
            title: 'Test', desc: '', author: '', likes: '0', collects: '0', comments: '0', tags: [],
        });
        await expect(command.func(page, { 'note-id': '69c131c9000000002800be4c' })).rejects.toMatchObject({
            code: 'ARGUMENT',
            message: expect.stringContaining('signed URL'),
            hint: expect.stringContaining('xsec_token'),
        });
        expect(page.goto).not.toHaveBeenCalled();
    });
    it('parses note ID from full /explore/ URL', async () => {
        const page = createPageMock({
            loginWall: false, notFound: false,
            title: 'Test', desc: '', author: '', likes: '0', collects: '0', comments: '0', tags: [],
        });
        await command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/explore/69c131c9000000002800be4c?xsec_token=abc',
        });
        expect(page.goto.mock.calls[0][0]).toContain('/explore/69c131c9000000002800be4c');
    });
    it('preserves full search_result URL with xsec_token for navigation', async () => {
        const page = createPageMock({
            loginWall: false, notFound: false,
            title: 'Test', desc: '', author: '', likes: '0', collects: '0', comments: '0', tags: [],
        });
        const fullUrl = 'https://www.xiaohongshu.com/search_result/69c131c9000000002800be4c?xsec_token=abc';
        await command.func(page, { 'note-id': fullUrl });
        // Should navigate to the full URL as-is, not strip the token
        expect(page.goto.mock.calls[0][0]).toBe(fullUrl);
    });
    it('preserves signed /user/profile/<user>/<note> URLs for navigation', async () => {
        const page = createPageMock({
            loginWall: false, notFound: false,
            title: 'Test', desc: '', author: '', likes: '0', collects: '0', comments: '0', tags: [],
        });
        const fullUrl = 'https://www.xiaohongshu.com/user/profile/user123/69c131c9000000002800be4c?xsec_token=abc&xsec_source=pc_user';
        await command.func(page, { 'note-id': fullUrl });
        expect(page.goto.mock.calls[0][0]).toBe(fullUrl);
    });
    it('throws AuthRequiredError on login wall', async () => {
        const page = createPageMock({ loginWall: true, notFound: false });
        await expect(command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=tok',
        })).rejects.toThrow('Note content requires login');
    });
    it('throws SECURITY_BLOCK with retry guidance when a full URL is blocked', async () => {
        const page = createPageMock({
            pageUrl: 'https://www.xiaohongshu.com/website-login/error?error_code=300031',
            securityBlock: true,
            loginWall: false,
            notFound: false,
        });
        await expect(command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/search_result/69c131c9000000002800be4c?xsec_token=abc',
        })).rejects.toMatchObject({
            code: 'SECURITY_BLOCK',
            hint: expect.stringContaining('Try again later'),
        });
    });
    it('throws EmptyResultError when note is not found', async () => {
        const page = createPageMock({ loginWall: false, notFound: true });
        await expect(command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=tok',
        })).rejects.toThrow('returned no data');
    });
    it('throws an empty-result error when the note page renders as an empty shell', async () => {
        const page = createPageMock({
            loginWall: false,
            notFound: false,
            title: '',
            desc: '',
            author: '',
            likes: '',
            collects: '',
            comments: '',
            tags: [],
        });
        try {
            await command.func(page, {
                'note-id': 'https://www.xiaohongshu.com/search_result/69ca3927000000001a020fd5?xsec_token=abc',
            });
            throw new Error('expected xiaohongshu note to fail on an empty shell page');
        }
        catch (error) {
            expect(error).toMatchObject({
                code: 'EMPTY_RESULT',
                hint: expect.stringContaining('loaded without visible content'),
            });
        }
    });
    it('keeps the empty-shell hint generic when the user already passed a full URL', async () => {
        const page = createPageMock({
            loginWall: false,
            notFound: false,
            title: '',
            desc: '',
            author: '',
            likes: '',
            collects: '',
            comments: '',
            tags: [],
        });
        try {
            await command.func(page, {
                'note-id': 'https://www.xiaohongshu.com/search_result/69ca3927000000001a020fd5?xsec_token=abc',
            });
            throw new Error('expected xiaohongshu note to fail on an empty shell page');
        }
        catch (error) {
            expect(error).toMatchObject({
                code: 'EMPTY_RESULT',
                hint: expect.stringContaining('loaded without visible content'),
            });
            expect(error.hint).not.toContain('bare note ID');
        }
    });
    it('normalizes placeholder text to 0 for zero-count metrics', async () => {
        const page = createPageMock({
            loginWall: false, notFound: false,
            title: 'New note', desc: 'Just posted', author: 'Author',
            likes: '赞', collects: '收藏', comments: '评论', tags: [],
        });
        const result = (await command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=tok',
        }));
        expect(result.find((r) => r.field === 'likes').value).toBe('0');
        expect(result.find((r) => r.field === 'collects').value).toBe('0');
        expect(result.find((r) => r.field === 'comments').value).toBe('0');
    });
    it('scopes metric selectors to .interact-container to avoid matching comment like buttons', async () => {
        const page = createPageMock({
            loginWall: false, notFound: false,
            title: 'Test', desc: '', author: 'Author', likes: '10', collects: '5', comments: '3', tags: [],
        });
        await command.func(page, { 'note-id': 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=tok' });
        const evaluateScript = page.evaluate.mock.calls[0][0];
        expect(evaluateScript).toContain('.interact-container .like-wrapper .count');
        expect(evaluateScript).toContain('.interact-container .collect-wrapper .count');
        expect(evaluateScript).toContain('.interact-container .chat-wrapper .count');
    });
    it('omits tags row when no tags present', async () => {
        const page = createPageMock({
            loginWall: false, notFound: false,
            title: 'No tags', desc: 'Content', author: 'Author',
            likes: '1', collects: '2', comments: '3', tags: [],
        });
        const result = (await command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=tok',
        }));
        expect(result.find((r) => r.field === 'tags')).toBeUndefined();
        expect(result).toHaveLength(13);
    });
});

describe('buildNoteExtractJs metadata extraction', () => {
    it('preserves stable identity, precise time, and structured media order', () => {
        const noteId = '69c131c9000000002800be4c';
        const dom = new JSDOM(`<!doctype html><html><body>
          <div id="detail-title">结构化笔记</div>
          <div id="detail-desc">完整正文</div>
          <div class="author-wrapper"><a href="/user/profile/dom-author"><span class="name">DOM 作者</span></a></div>
          <div class="interact-container">
            <div class="like-wrapper"><span class="count">11</span></div>
            <div class="collect-wrapper"><span class="count">12</span></div>
            <div class="chat-wrapper"><span class="count">13</span></div>
          </div>
        </body></html>`, {
            url: `https://www.xiaohongshu.com/search_result/${noteId}?xsec_token=abc`,
            runScripts: 'outside-only',
        });
        dom.window.__INITIAL_STATE__ = {
            note: {
                noteDetailMap: {
                    [noteId]: {
                        note: {
                            time: Date.parse('2026-03-18T20:01:00+08:00'),
                            user: { userId: 'stable-author', nickname: '结构化作者' },
                            imageList: [
                                { urlDefault: 'https://sns-img-bd.xhscdn.com/cover.jpg' },
                                { urlDefault: 'https://sns-img-bd.xhscdn.com/second.jpg' },
                            ],
                        },
                    },
                },
            },
        };

        const result = dom.window.eval(buildNoteExtractJs(noteId));

        expect(result).toMatchObject({
            id: noteId,
            url: `https://www.xiaohongshu.com/explore/${noteId}`,
            author_id: 'stable-author',
            author_url: 'https://www.xiaohongshu.com/user/profile/stable-author',
            published_at: '2026-03-18T12:01:00.000Z',
            published_at_source: 'initial_state',
        });
        expect(result.media).toEqual([
            { type: 'image', url: 'https://sns-img-bd.xhscdn.com/cover.jpg' },
            { type: 'image', url: 'https://sns-img-bd.xhscdn.com/second.jpg' },
        ]);
    });
});
