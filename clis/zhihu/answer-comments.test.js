import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import './answer-comments.js';
import { __test__ as helpers } from './answer-comments.js';

describe('zhihu answer-comments', () => {
    it('registers as a cookie read command', () => {
        const cmd = getRegistry().get('zhihu/answer-comments');
        expect(cmd).toBeDefined();
        expect(cmd.access).toBe('read');
        expect(cmd.strategy).toBe('cookie');
    });

    it('returns flattened comments while limiting only top-level comments', async () => {
        const cmd = getRegistry().get('zhihu/answer-comments');
        const goto = vi.fn().mockResolvedValue(undefined);
        const evaluate = vi.fn().mockImplementation(async (js) => {
            expect(js).toContain('/api/v4/answers/2036567240334653053/comments?order=normal&limit=20');
            expect(js).toContain("credentials: 'include'");
            return {
                data: [
                    {
                        id: 'c1',
                        author: { member: { id: 'u1', name: 'alice' } },
                        vote_count: 3,
                        created_time: 1700000000,
                        content: '<p>top &#34;one&#34;</p>',
                    },
                    {
                        id: 'r1',
                        author: { member: { id: 'u2', name: 'bob' } },
                        reply_to_author: { member: { id: 'u1', name: 'alice' } },
                        vote_count: 1,
                        created_time: 1700000100,
                        content: '<p>reply one</p>',
                    },
                    {
                        id: 'r2',
                        author: { member: { id: 'u3', name: 'carol' } },
                        reply_to_author: { member: { id: 'u1', name: 'alice' } },
                        vote_count: 2,
                        created_time: 1700000200,
                        content: '<p>reply two should be capped</p>',
                    },
                    {
                        id: 'c2',
                        author: { member: { id: 'u4', name: 'dave' } },
                        vote_count: 4,
                        created_time: 1700000300,
                        content: '<p>top two</p>',
                    },
                    {
                        id: 'c3',
                        author: { member: { id: 'u5', name: 'erin' } },
                        vote_count: 5,
                        content: '<p>top three should stop the page walk</p>',
                    },
                ],
                paging: { is_end: false, next: 'https://www.zhihu.com/api/v4/answers/2036567240334653053/comments?offset=20' },
            };
        });
        const page = {
            goto,
            getCurrentUrl: vi.fn().mockResolvedValue('https://www.zhihu.com/question/2022852734622114542/answer/2036567240334653053'),
            evaluate,
        };
        await expect(cmd.func(page, {
            id: 'https://www.zhihu.com/question/2022852734622114542/answer/2036567240334653053',
            limit: 2,
            'replies-limit': 1,
        })).resolves.toEqual([
            {
                rank: 1,
                comment_rank: 1,
                reply_rank: 0,
                depth: 0,
                id: 'c1',
                parent_id: '',
                author: 'alice',
                reply_to: '',
                likes: 3,
                created_at: '2023-11-14T22:13:20.000Z',
                url: 'https://www.zhihu.com/question/2022852734622114542/answer/2036567240334653053#comment-c1',
                content: 'top "one"',
            },
            {
                rank: 2,
                comment_rank: 1,
                reply_rank: 1,
                depth: 1,
                id: 'r1',
                parent_id: 'c1',
                author: 'bob',
                reply_to: 'alice',
                likes: 1,
                created_at: '2023-11-14T22:15:00.000Z',
                url: 'https://www.zhihu.com/question/2022852734622114542/answer/2036567240334653053#comment-r1',
                content: 'reply one',
            },
            {
                rank: 3,
                comment_rank: 2,
                reply_rank: 0,
                depth: 0,
                id: 'c2',
                parent_id: '',
                author: 'dave',
                reply_to: '',
                likes: 4,
                created_at: '2023-11-14T22:18:20.000Z',
                url: 'https://www.zhihu.com/question/2022852734622114542/answer/2036567240334653053#comment-c2',
                content: 'top two',
            },
        ]);
        expect(goto).toHaveBeenCalledWith('https://www.zhihu.com/answer/2036567240334653053');
        expect(evaluate).toHaveBeenCalledTimes(1);
    });

    it('follows paging.next until enough top-level comments are collected', async () => {
        const cmd = getRegistry().get('zhihu/answer-comments');
        const evaluate = vi.fn()
            .mockResolvedValueOnce({
                data: [
                    { id: 'c1', author: { member: { id: 'u1', name: 'alice' } }, content: 'first' },
                    { id: 'r1', author: { member: { id: 'u2', name: 'bob' } }, reply_to_author: { member: { id: 'u1', name: 'alice' } }, content: 'reply' },
                ],
                paging: { is_end: false, next: 'https://www.zhihu.com/api/v4/answers/1/comments?offset=20' },
            })
            .mockResolvedValueOnce({
                data: [
                    { id: 'c2', author: { member: { id: 'u3', name: 'carol' } }, content: 'second' },
                ],
                paging: { is_end: true },
            });
        const page = { goto: vi.fn().mockResolvedValue(undefined), evaluate };
        const rows = await cmd.func(page, { id: '1', limit: 2, 'replies-limit': 0 });
        expect(rows.map((row) => row.id)).toEqual(['c1', 'c2']);
        expect(evaluate).toHaveBeenCalledTimes(2);
        expect(evaluate.mock.calls[1][0]).toContain('offset=20');
    });

    it('supports typed answer targets', async () => {
        const cmd = getRegistry().get('zhihu/answer-comments');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ data: [], paging: { is_end: true } }),
        };
        await expect(cmd.func(page, { id: 'answer:2022852734622114542:2036567240334653053', limit: 1, 'replies-limit': 0 })).resolves.toEqual([]);
        expect(page.goto).toHaveBeenCalledWith('https://www.zhihu.com/answer/2036567240334653053');
    });

    it('maps auth failures to AuthRequiredError', async () => {
        const cmd = getRegistry().get('zhihu/answer-comments');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ __httpError: 403 }),
        };
        await expect(cmd.func(page, { id: '1', limit: 1, 'replies-limit': 0 })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('maps malformed responses to CommandExecutionError', async () => {
        const cmd = getRegistry().get('zhihu/answer-comments');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ data: {} }),
        };
        await expect(cmd.func(page, { id: '1', limit: 1, 'replies-limit': 0 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('rejects invalid inputs before navigation', async () => {
        const cmd = getRegistry().get('zhihu/answer-comments');
        const page = { goto: vi.fn(), evaluate: vi.fn() };
        await expect(cmd.func(page, { id: 'not-an-answer', limit: 1, 'replies-limit': 0 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(cmd.func(page, { id: '1', limit: 0, 'replies-limit': 0 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(cmd.func(page, { id: '1', limit: 1001, 'replies-limit': 0 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(cmd.func(page, { id: '1', limit: 1, 'replies-limit': -1 })).rejects.toBeInstanceOf(ArgumentError);
        await expect(cmd.func(page, { id: '1', limit: 1, 'replies-limit': 101 })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });
});

describe('zhihu answer-comments helpers', () => {
    it('parseAnswerTarget handles exact input shapes', () => {
        expect(helpers.parseAnswerTarget('123')).toEqual({ answerId: '123', questionId: '' });
        expect(helpers.parseAnswerTarget('answer:10:123')).toEqual({ answerId: '123', questionId: '10' });
        expect(helpers.parseAnswerTarget('https://www.zhihu.com/question/10/answer/123')).toEqual({ answerId: '123', questionId: '10' });
        expect(helpers.parseAnswerTarget('https://zhihu.com/answer/123?utm=1')).toEqual({ answerId: '123', questionId: '' });
        expect(helpers.parseAnswerTarget('https://example.com/question/10/answer/123')).toBeNull();
    });

    it('buildRows reconstructs nested reply depth from previously seen authors', () => {
        const rows = helpers.buildRows([
            { id: 'c1', author: { member: { id: 'u1', name: 'alice' } }, content: 'top' },
            { id: 'r1', author: { member: { id: 'u2', name: 'bob' } }, reply_to_author: { member: { id: 'u1', name: 'alice' } }, content: 'reply' },
            { id: 'r2', author: { member: { id: 'u3', name: 'carol' } }, reply_to_author: { member: { id: 'u2', name: 'bob' } }, content: 'nested' },
        ], { answerId: 'a1', questionId: 'q1', topLevelLimit: 1, repliesLimit: 5 }).rows;
        expect(rows.map((row) => [row.id, row.parent_id, row.depth, row.comment_rank, row.reply_rank])).toEqual([
            ['c1', '', 0, 1, 0],
            ['r1', 'c1', 1, 1, 1],
            ['r2', 'r1', 2, 1, 2],
        ]);
    });
});
