import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { AuthRequiredError, CliError } from '@jackwener/opencli/errors';
import './question.js';
describe('zhihu question', () => {
    it('returns answers from the Zhihu API', async () => {
        const cmd = getRegistry().get('zhihu/question');
        expect(cmd?.func).toBeTypeOf('function');
        const goto = vi.fn().mockResolvedValue(undefined);
        const evaluate = vi.fn().mockImplementation(async (js) => {
            // Per-request page size is the Zhihu API maximum (20). The
            // user-requested `--limit 3` is enforced by the dedup loop's
            // `answers.length >= answerLimit` break, not by the fetch URL.
            expect(js).toContain('questions/2021881398772981878/answers?limit=20');
            expect(js).toContain('content,url,voteup_count');
            expect(js).toContain("credentials: 'include'");
            return {
                data: [
                    {
                        id: '2036567240334653053',
                        author: { name: 'alice' },
                        voteup_count: 12,
                        content: 'Hello Zhihu',
                    },
                ],
            };
        });
        const page = { goto, evaluate };
        await expect(cmd.func(page, { id: '2021881398772981878', limit: 3 })).resolves.toEqual([
            {
                rank: 1,
                id: '2036567240334653053',
                author: 'alice',
                votes: 12,
                url: 'https://www.zhihu.com/question/2021881398772981878/answer/2036567240334653053',
                content: 'Hello Zhihu',
            },
        ]);
        expect(goto).toHaveBeenCalledWith('https://www.zhihu.com/question/2021881398772981878');
        expect(evaluate).toHaveBeenCalledTimes(1);
    });
    it('prefers the answer URL when extracting large answer IDs', async () => {
        const cmd = getRegistry().get('zhihu/question');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({
                data: [
                    {
                        id: 2036567240334653000,
                        url: 'https://www.zhihu.com/api/v4/answers/2036567240334653053',
                        author: { name: 'alice' },
                        voteup_count: 12,
                        content: '<p>precise id</p>',
                    },
                ],
                paging: { is_end: true },
            }),
        };
        await expect(cmd.func(page, { id: '2021881398772981878', limit: 1 })).resolves.toEqual([
            {
                rank: 1,
                id: '2036567240334653053',
                author: 'alice',
                votes: 12,
                url: 'https://www.zhihu.com/question/2021881398772981878/answer/2036567240334653053',
                content: 'precise id',
            },
        ]);
    });
    it('deduplicates paginated answers by precise answer URL identity', async () => {
        const cmd = getRegistry().get('zhihu/question');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({
                data: [
                    {
                        id: 2036567240334653000,
                        url: 'https://www.zhihu.com/api/v4/answers/2036567240334653053',
                        author: { name: 'alice' },
                        voteup_count: 12,
                        content: '<p>first precise id</p>',
                    },
                    {
                        id: 2036567240334653000,
                        url: 'https://www.zhihu.com/api/v4/answers/2036567240334653054',
                        author: { name: 'bob' },
                        voteup_count: 8,
                        content: '<p>second precise id</p>',
                    },
                ],
                paging: { is_end: true },
            }),
        };
        await expect(cmd.func(page, { id: '2021881398772981878', limit: 2 })).resolves.toEqual([
            {
                rank: 1,
                id: '2036567240334653053',
                author: 'alice',
                votes: 12,
                url: 'https://www.zhihu.com/question/2021881398772981878/answer/2036567240334653053',
                content: 'first precise id',
            },
            {
                rank: 2,
                id: '2036567240334653054',
                author: 'bob',
                votes: 8,
                url: 'https://www.zhihu.com/question/2021881398772981878/answer/2036567240334653054',
                content: 'second precise id',
            },
        ]);
    });
    it('follows paging.next until the requested limit is reached', async () => {
        const cmd = getRegistry().get('zhihu/question');
        const goto = vi.fn().mockResolvedValue(undefined);
        const evaluate = vi.fn()
            .mockResolvedValueOnce({
                data: [
                    { id: '101', author: { name: 'alice' }, voteup_count: 12, content: '<p>first</p>' },
                    { id: '102', author: { name: 'bob' }, voteup_count: 8, content: '<p>second</p>' },
                ],
                paging: {
                    is_end: false,
                    next: 'https://www.zhihu.com/api/v4/questions/2021881398772981878/answers?limit=2&offset=80&sort_by=default',
                },
            })
            .mockResolvedValueOnce({
                data: [
                    { id: '102', author: { name: 'bob duplicate' }, voteup_count: 8, content: '<p>duplicate</p>' },
                    { id: '103', author: { name: 'carol' }, voteup_count: 5, content: '<p>third</p>' },
                ],
                paging: { is_end: true },
            });
        const page = { goto, evaluate };
        await expect(cmd.func(page, { id: '2021881398772981878', limit: 3 })).resolves.toEqual([
            { rank: 1, id: '101', author: 'alice', votes: 12, url: 'https://www.zhihu.com/question/2021881398772981878/answer/101', content: 'first' },
            { rank: 2, id: '102', author: 'bob', votes: 8, url: 'https://www.zhihu.com/question/2021881398772981878/answer/102', content: 'second' },
            { rank: 3, id: '103', author: 'carol', votes: 5, url: 'https://www.zhihu.com/question/2021881398772981878/answer/103', content: 'third' },
        ]);
        expect(evaluate).toHaveBeenCalledTimes(2);
        expect(evaluate.mock.calls[1][0]).toContain('offset=80');
    });
    it('supports created-time sorting', async () => {
        const cmd = getRegistry().get('zhihu/question');
        const goto = vi.fn().mockResolvedValue(undefined);
        const evaluate = vi.fn().mockImplementation(async (js) => {
            expect(js).toContain('sort_by=created');
            return {
                data: [
                    {
                        id: '101',
                        author: { name: 'newest' },
                        voteup_count: 1,
                        content: '<p>created order</p>',
                    },
                ],
                paging: { is_end: true },
            };
        });
        const page = { goto, evaluate };
        await expect(cmd.func(page, { id: '2021881398772981878', limit: 1, sort: 'created' })).resolves.toEqual([
            { rank: 1, id: '101', author: 'newest', votes: 1, url: 'https://www.zhihu.com/question/2021881398772981878/answer/101', content: 'created order' },
        ]);
        expect(goto).toHaveBeenCalledWith('https://www.zhihu.com/question/2021881398772981878/answers/updated');
    });
    it('does not emit a fake answer URL for malformed answer IDs', async () => {
        const cmd = getRegistry().get('zhihu/question');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({
                data: [
                    {
                        id: 'not-an-id',
                        author: { name: 'alice' },
                        voteup_count: 12,
                        content: '<p>malformed id</p>',
                    },
                ],
                paging: { is_end: true },
            }),
        };
        await expect(cmd.func(page, { id: '2021881398772981878', limit: 1 })).resolves.toEqual([
            {
                rank: 1,
                id: '',
                author: 'alice',
                votes: 12,
                url: '',
                content: 'malformed id',
            },
        ]);
    });
    it('maps auth-like answer failures to AuthRequiredError', async () => {
        const cmd = getRegistry().get('zhihu/question');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ __httpError: 403 }),
        };
        await expect(cmd.func(page, { id: '2021881398772981878', limit: 3 })).rejects.toBeInstanceOf(AuthRequiredError);
    });
    it('preserves non-auth fetch failures as CliError', async () => {
        const cmd = getRegistry().get('zhihu/question');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ __httpError: 500 }),
        };
        await expect(cmd.func(page, { id: '2021881398772981878', limit: 3 })).rejects.toMatchObject({
            code: 'FETCH_ERROR',
            message: 'Zhihu question answers request failed (HTTP 500)',
        });
    });
    it('handles null evaluate response as fetch error', async () => {
        const cmd = getRegistry().get('zhihu/question');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue(null),
        };
        await expect(cmd.func(page, { id: '2021881398772981878', limit: 3 })).rejects.toMatchObject({
            code: 'FETCH_ERROR',
            message: 'Zhihu question answers request failed',
        });
    });
    it('rejects non-numeric question IDs', async () => {
        const cmd = getRegistry().get('zhihu/question');
        const page = { goto: vi.fn(), evaluate: vi.fn() };
        await expect(cmd.func(page, { id: "abc'; alert(1); //", limit: 1 })).rejects.toBeInstanceOf(CliError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });
    it('rejects invalid limits before navigation', async () => {
        const cmd = getRegistry().get('zhihu/question');
        const page = { goto: vi.fn(), evaluate: vi.fn() };
        await expect(cmd.func(page, { id: '2021881398772981878', limit: 0 })).rejects.toBeInstanceOf(CliError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });
    it('rejects excessive limits before navigation', async () => {
        const cmd = getRegistry().get('zhihu/question');
        const page = { goto: vi.fn(), evaluate: vi.fn() };
        await expect(cmd.func(page, { id: '2021881398772981878', limit: 1001 })).rejects.toBeInstanceOf(CliError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });
    it('rejects invalid sort before navigation', async () => {
        const cmd = getRegistry().get('zhihu/question');
        const page = { goto: vi.fn(), evaluate: vi.fn() };
        await expect(cmd.func(page, { id: '2021881398772981878', limit: 1, sort: 'unknown' })).rejects.toBeInstanceOf(CliError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });
});
