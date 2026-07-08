import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { AuthRequiredError, CliError } from '@jackwener/opencli/errors';
import './recommend.js';

describe('zhihu recommend', () => {
    it('returns recommendations from the Zhihu feed API', async () => {
        const cmd = getRegistry().get('zhihu/recommend');
        expect(cmd?.func).toBeTypeOf('function');
        const goto = vi.fn().mockResolvedValue(undefined);
        const evaluate = vi.fn().mockImplementation(async (js) => {
            expect(js).toContain('/api/v3/feed/topstory/recommend?limit=10&desktop=true');
            expect(js).toContain("credentials: 'include'");
            return {
                data: [
                    {
                        id: '0_1',
                        target: {
                            id: '101',
                            type: 'answer',
                            author: { name: 'alice' },
                            voteup_count: 12,
                            question: { id: '202', title: 'Question title' },
                        },
                    },
                    {
                        id: '1_1',
                        target: {
                            id: '303',
                            type: 'article',
                            title: 'Article title',
                            author: { name: 'bob' },
                            reaction: { statistics: { like_count: 7 } },
                        },
                    },
                ],
                paging: { is_end: true },
            };
        });
        const page = { goto, evaluate };
        await expect(cmd.func(page, { limit: 2 })).resolves.toEqual([
            {
                rank: 1,
                type: 'answer',
                title: 'Question title',
                author: 'alice',
                votes: 12,
                url: 'https://www.zhihu.com/question/202/answer/101',
            },
            {
                rank: 2,
                type: 'article',
                title: 'Article title',
                author: 'bob',
                votes: 7,
                url: 'https://zhuanlan.zhihu.com/p/303',
            },
        ]);
        expect(goto).toHaveBeenCalledWith('https://www.zhihu.com');
        expect(evaluate).toHaveBeenCalledTimes(1);
    });

    it('follows paging.next until the requested limit is reached', async () => {
        const cmd = getRegistry().get('zhihu/recommend');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn()
                .mockResolvedValueOnce({
                    data: [
                        { id: '0_1', target: { id: 'a1', type: 'answer', author: { name: 'alice' }, question: { id: 'q1', title: 'first' } } },
                        { id: '1_1', target: { id: 'a2', type: 'answer', author: { name: 'bob' }, question: { id: 'q2', title: 'second' } } },
                    ],
                    paging: {
                        is_end: false,
                        next: 'https://www.zhihu.com/api/v3/feed/topstory/recommend?action=down&after_id=1&page_number=2',
                    },
                })
                .mockResolvedValueOnce({
                    data: [
                        { id: '1_1', target: { id: 'a2', type: 'answer', author: { name: 'bob duplicate' }, question: { id: 'q2', title: 'duplicate' } } },
                        { id: '2_1', target: { id: 'q3', type: 'question', title: 'third' } },
                    ],
                    paging: { is_end: true },
                }),
        };
        await expect(cmd.func(page, { limit: 3 })).resolves.toEqual([
            { rank: 1, type: 'answer', title: 'first', author: 'alice', votes: 0, url: 'https://www.zhihu.com/question/q1/answer/a1' },
            { rank: 2, type: 'answer', title: 'second', author: 'bob', votes: 0, url: 'https://www.zhihu.com/question/q2/answer/a2' },
            { rank: 3, type: 'question', title: 'third', author: '', votes: 0, url: 'https://www.zhihu.com/question/q3' },
        ]);
        expect(page.evaluate).toHaveBeenCalledTimes(2);
        expect(page.evaluate.mock.calls[1][0]).toContain('after_id=1');
    });

    it('maps auth-like failures to AuthRequiredError', async () => {
        const cmd = getRegistry().get('zhihu/recommend');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ __httpError: 403 }),
        };
        await expect(cmd.func(page, { limit: 3 })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('preserves non-auth fetch failures as CliError', async () => {
        const cmd = getRegistry().get('zhihu/recommend');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ __httpError: 500 }),
        };
        await expect(cmd.func(page, { limit: 3 })).rejects.toMatchObject({
            code: 'FETCH_ERROR',
            message: 'Zhihu recommendations request failed (HTTP 500)',
        });
    });

    it('handles null evaluate response as fetch error', async () => {
        const cmd = getRegistry().get('zhihu/recommend');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue(null),
        };
        await expect(cmd.func(page, { limit: 3 })).rejects.toMatchObject({
            code: 'FETCH_ERROR',
            message: 'Zhihu recommendations request failed',
        });
    });

    it('rejects invalid limits before navigation', async () => {
        const cmd = getRegistry().get('zhihu/recommend');
        const page = { goto: vi.fn(), evaluate: vi.fn() };
        await expect(cmd.func(page, { limit: 0 })).rejects.toBeInstanceOf(CliError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('rejects excessive limits before navigation', async () => {
        const cmd = getRegistry().get('zhihu/recommend');
        const page = { goto: vi.fn(), evaluate: vi.fn() };
        await expect(cmd.func(page, { limit: 1001 })).rejects.toBeInstanceOf(CliError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });
});
