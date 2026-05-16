import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { AuthRequiredError, CliError } from '@jackwener/opencli/errors';
import './search.js';

describe('zhihu search', () => {
    it('returns search_result entries from the Zhihu search API', async () => {
        const cmd = getRegistry().get('zhihu/search');
        expect(cmd?.func).toBeTypeOf('function');
        const goto = vi.fn().mockResolvedValue(undefined);
        const evaluate = vi.fn().mockImplementation(async (js) => {
            expect(js).toContain('/api/v4/search_v3');
            expect(js).toContain('limit=20');
            expect(js).toContain("credentials: 'include'");
            return {
                data: [
                    {
                        type: 'hot_timing',
                        object: {
                            type: 'hot_timing',
                            content_items: [
                                { object: { id: 'discussion-1', type: 'article', title: 'discussion' } },
                            ],
                        },
                    },
                    {
                        type: 'search_result',
                        object: {
                            id: 'a1',
                            type: 'answer',
                            author: { name: 'alice' },
                            voteup_count: 12,
                            question: { id: 'q1', name: '<em>Codex</em> question' },
                        },
                    },
                    {
                        type: 'search_result',
                        object: {
                            id: 'p1',
                            type: 'article',
                            title: '<em>Codex</em> article',
                            author: { name: 'bob' },
                            voteup_count: 7,
                        },
                    },
                ],
                paging: { is_end: true },
            };
        });
        const page = { goto, evaluate };
        await expect(cmd.func(page, { query: 'codex', limit: 2 })).resolves.toEqual([
            {
                rank: 1,
                title: 'Codex question',
                type: 'answer',
                author: 'alice',
                votes: 12,
                url: 'https://www.zhihu.com/question/q1/answer/a1',
            },
            {
                rank: 2,
                title: 'Codex article',
                type: 'article',
                author: 'bob',
                votes: 7,
                url: 'https://zhuanlan.zhihu.com/p/p1',
            },
        ]);
        expect(goto).toHaveBeenCalledWith('https://www.zhihu.com');
        expect(evaluate).toHaveBeenCalledTimes(1);
    });

    it('follows paging.next until the requested limit is reached', async () => {
        const cmd = getRegistry().get('zhihu/search');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({
                    data: [
                        { type: 'search_result', object: { id: 'a1', type: 'answer', question: { id: 'q1', name: 'first' } } },
                        { type: 'search_result', object: { id: 'a2', type: 'answer', question: { id: 'q2', name: 'second' } } },
                    ],
                    paging: {
                        is_end: false,
                        next: 'https://api.zhihu.com/search_v3?offset=20&q=codex',
                    },
                })
                .mockResolvedValueOnce({
                    data: [
                        { type: 'search_result', object: { id: 'a2', type: 'answer', question: { id: 'q2', name: 'duplicate' } } },
                        { type: 'search_result', object: { id: 'q3', type: 'question', title: 'third' } },
                    ],
                    paging: { is_end: true },
                }),
        };
        await expect(cmd.func(page, { query: 'codex', limit: 3 })).resolves.toEqual([
            { rank: 1, title: 'first', type: 'answer', author: '', votes: 0, url: 'https://www.zhihu.com/question/q1/answer/a1' },
            { rank: 2, title: 'second', type: 'answer', author: '', votes: 0, url: 'https://www.zhihu.com/question/q2/answer/a2' },
            { rank: 3, title: 'third', type: 'question', author: '', votes: 0, url: 'https://www.zhihu.com/question/q3' },
        ]);
        expect(page.evaluate).toHaveBeenCalledTimes(2);
        expect(page.evaluate.mock.calls[1][0]).toContain('https://www.zhihu.com/api/v4/search_v3?offset=20&q=codex');
    });

    it('filters by result type', async () => {
        const cmd = getRegistry().get('zhihu/search');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({
                data: [
                    { type: 'search_result', object: { id: 'a1', type: 'answer', question: { id: 'q1', name: 'answer' } } },
                    { type: 'search_result', object: { id: 'p1', type: 'article', title: 'article' } },
                ],
                paging: { is_end: true },
            }),
        };
        await expect(cmd.func(page, { query: 'codex', limit: 2, type: 'article' })).resolves.toEqual([
            { rank: 1, title: 'article', type: 'article', author: '', votes: 0, url: 'https://zhuanlan.zhihu.com/p/p1' },
        ]);
    });

    it('maps auth-like failures to AuthRequiredError', async () => {
        const cmd = getRegistry().get('zhihu/search');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ __httpError: 403 }),
        };
        await expect(cmd.func(page, { query: 'codex', limit: 3 })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('preserves non-auth fetch failures as CliError', async () => {
        const cmd = getRegistry().get('zhihu/search');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ __httpError: 500 }),
        };
        await expect(cmd.func(page, { query: 'codex', limit: 3 })).rejects.toMatchObject({
            code: 'FETCH_ERROR',
            message: 'Zhihu search request failed (HTTP 500)',
        });
    });

    it('rejects invalid input before navigation', async () => {
        const cmd = getRegistry().get('zhihu/search');
        const page = { goto: vi.fn(), evaluate: vi.fn() };
        await expect(cmd.func(page, { query: '', limit: 1 })).rejects.toBeInstanceOf(CliError);
        await expect(cmd.func(page, { query: 'codex', limit: 0 })).rejects.toBeInstanceOf(CliError);
        await expect(cmd.func(page, { query: 'codex', limit: 1001 })).rejects.toBeInstanceOf(CliError);
        await expect(cmd.func(page, { query: 'codex', limit: 1, type: 'video' })).rejects.toBeInstanceOf(CliError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });
});
