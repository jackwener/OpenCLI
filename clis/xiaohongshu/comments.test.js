import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './comments.js';
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
describe('xiaohongshu comments', () => {
    const command = getRegistry().get('xiaohongshu/comments');
    it('returns ranked comment rows for signed full URLs', async () => {
        const page = createPageMock({
            loginWall: false,
            results: [
                { author: 'Alice', text: 'Great note!', likes: 10, time: '2024-01-01', is_reply: false, reply_to: '' },
                { author: 'Bob', text: 'Very helpful', likes: 0, time: '2024-01-02', is_reply: false, reply_to: '' },
            ],
        });
        const signedUrl = 'https://www.xiaohongshu.com/search_result/69aadbcb000000002202f131?xsec_token=abc&xsec_source=pc_search';
        const result = (await command.func(page, { 'note-id': signedUrl, limit: 5 }));
        expect(page.goto.mock.calls[0][0]).toBe(signedUrl);
        expect(result).toHaveLength(2);
        expect(result[0]).toMatchObject({ rank: 1, author: 'Alice', text: 'Great note!', likes: 10 });
        expect(result[1]).toMatchObject({ rank: 2, author: 'Bob', text: 'Very helpful', likes: 0 });
    });
    it('rejects bare note IDs before browser navigation', async () => {
        const page = createPageMock({ loginWall: false, results: [] });
        await expect(command.func(page, { 'note-id': '69aadbcb000000002202f131', limit: 5 })).rejects.toMatchObject({
            code: 'ARGUMENT',
            message: expect.stringContaining('signed URL'),
            hint: expect.stringContaining('xsec_token'),
        });
        expect(page.goto).not.toHaveBeenCalled();
    });
    it('preserves signed /explore/ URL as-is for navigation', async () => {
        const page = createPageMock({
            loginWall: false,
            results: [{ author: 'Alice', text: 'Nice', likes: 1, time: '2024-01-01', is_reply: false, reply_to: '' }],
        });
        await command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/explore/69aadbcb000000002202f131?xsec_token=abc&xsec_source=pc_search',
            limit: 5,
        });
        expect(page.goto.mock.calls[0][0]).toContain('/explore/69aadbcb000000002202f131?xsec_token=abc');
    });
    it('preserves full search_result URL with xsec_token for navigation', async () => {
        const page = createPageMock({
            loginWall: false,
            results: [{ author: 'Alice', text: 'Nice', likes: 1, time: '2024-01-01', is_reply: false, reply_to: '' }],
        });
        const fullUrl = 'https://www.xiaohongshu.com/search_result/69aadbcb000000002202f131?xsec_token=abc&xsec_source=pc_search';
        await command.func(page, { 'note-id': fullUrl, limit: 5 });
        expect(page.goto.mock.calls[0][0]).toBe(fullUrl);
    });
    it('preserves signed /user/profile/<user>/<note> URLs for navigation', async () => {
        const page = createPageMock({
            loginWall: false,
            results: [{ author: 'Alice', text: 'Nice', likes: 1, time: '2024-01-01', is_reply: false, reply_to: '' }],
        });
        const fullUrl = 'https://www.xiaohongshu.com/user/profile/user123/69aadbcb000000002202f131?xsec_token=abc&xsec_source=pc_user';
        await command.func(page, { 'note-id': fullUrl, limit: 5 });
        expect(page.goto.mock.calls[0][0]).toBe(fullUrl);
    });
    it('throws AuthRequiredError when login wall is detected', async () => {
        const page = createPageMock({ loginWall: true, results: [] });
        await expect(command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=tok',
            limit: 5,
        })).rejects.toThrow('Note comments require login');
    });
    it('throws SECURITY_BLOCK with retry guidance when a full URL comments page is blocked', async () => {
        const page = createPageMock({
            pageUrl: 'https://www.xiaohongshu.com/website-login/error?error_code=300031',
            securityBlock: true,
            loginWall: false,
            results: [],
        });
        await expect(command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/search_result/69aadbcb000000002202f131?xsec_token=abc&xsec_source=pc_search',
            limit: 5,
        })).rejects.toMatchObject({
            code: 'SECURITY_BLOCK',
            hint: expect.stringContaining('Try again later'),
        });
    });
    it('returns empty array when no comments are found', async () => {
        const page = createPageMock({ loginWall: false, results: [] });
        await expect(command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=tok',
            limit: 5,
        })).resolves.toEqual([]);
    });
    it('uses condition-based comment scrolling instead of a fixed blind loop', async () => {
        const page = createPageMock({ loginWall: false, results: [] });
        await command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=tok',
            limit: 5,
        });
        const script = page.evaluate.mock.calls[0][0];
        expect(script).toContain("const beforeCount = scroller.querySelectorAll('.parent-comment').length");
        expect(script).toContain("const afterCount = scroller.querySelectorAll('.parent-comment').length");
        expect(script).toContain('if (afterCount <= beforeCount) break');
    });
    it('respects the limit for top-level comments', async () => {
        const manyComments = Array.from({ length: 10 }, (_, i) => ({
            author: `User${i}`,
            text: `Comment ${i}`,
            likes: i,
            time: '2024-01-01',
            is_reply: false,
            reply_to: '',
        }));
        const page = createPageMock({ loginWall: false, results: manyComments });
        const result = (await command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=tok',
            limit: 3,
        }));
        expect(result).toHaveLength(3);
        expect(result[0].rank).toBe(1);
        expect(result[2].rank).toBe(3);
    });
    it('clamps invalid negative limits to a safe minimum', async () => {
        const page = createPageMock({
            loginWall: false,
            results: [
                { author: 'Alice', text: 'Great note!', likes: 10, time: '2024-01-01', is_reply: false, reply_to: '' },
                { author: 'Bob', text: 'Very helpful', likes: 0, time: '2024-01-02', is_reply: false, reply_to: '' },
            ],
        });
        const result = (await command.func(page, {
            'note-id': 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=tok',
            limit: -3,
        }));
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ rank: 1, author: 'Alice' });
    });
    describe('--with-replies', () => {
        it('includes reply rows with is_reply=true and reply_to set', async () => {
            const page = createPageMock({
                loginWall: false,
                results: [
                    { author: 'Alice', text: 'Main comment', likes: 10, time: '03-25', is_reply: false, reply_to: '' },
                    { author: 'Bob', text: 'Reply to Alice', likes: 3, time: '03-25', is_reply: true, reply_to: 'Alice' },
                    { author: 'Carol', text: 'Another top', likes: 5, time: '03-26', is_reply: false, reply_to: '' },
                ],
            });
            const result = (await command.func(page, {
                'note-id': 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=tok', limit: 50, 'with-replies': true,
            }));
            expect(result).toHaveLength(3);
            expect(result[0]).toMatchObject({ author: 'Alice', is_reply: false, reply_to: '' });
            expect(result[1]).toMatchObject({ author: 'Bob', is_reply: true, reply_to: 'Alice' });
            expect(result[2]).toMatchObject({ author: 'Carol', is_reply: false, reply_to: '' });
            const script = page.evaluate.mock.calls[0][0];
            expect(script).toContain('共\\d+条回复');
            expect(script).toContain('el.click()');
        });
        it('limits by top-level count, keeping attached replies', async () => {
            const page = createPageMock({
                loginWall: false,
                results: [
                    { author: 'A', text: 'Top 1', likes: 0, time: '', is_reply: false, reply_to: '' },
                    { author: 'A1', text: 'Reply 1', likes: 0, time: '', is_reply: true, reply_to: 'A' },
                    { author: 'A2', text: 'Reply 2', likes: 0, time: '', is_reply: true, reply_to: 'A' },
                    { author: 'B', text: 'Top 2', likes: 0, time: '', is_reply: false, reply_to: '' },
                    { author: 'C', text: 'Top 3', likes: 0, time: '', is_reply: false, reply_to: '' },
                ],
            });
            // Limit to 2 top-level comments — should include A + 2 replies + B = 4 rows
            const result = (await command.func(page, {
                'note-id': 'https://www.xiaohongshu.com/search_result/abc123?xsec_token=tok', limit: 2, 'with-replies': true,
            }));
            expect(result).toHaveLength(4);
            expect(result.map((r) => r.author)).toEqual(['A', 'A1', 'A2', 'B']);
        });
    });
});
