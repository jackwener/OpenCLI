import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { AuthRequiredError, CliError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './user-answers.js';

describe('zhihu user-answers', () => {
    it('maps a user answers list to rows', async () => {
        const cmd = getRegistry().get('zhihu/user-answers');
        expect(cmd?.func).toBeTypeOf('function');
        const evaluate = vi.fn().mockImplementation(async (js) => {
            expect(js).toContain('/api/v4/members/wen-jie-16-47/answers');
            return {
                data: [
                    { id: 'a1', voteup_count: 10, comment_count: 12, created_time: 1780888788, question: { id: 'q1', title: 'Q1' } },
                    { id: 'a2', reaction: { statistics: { like_count: 3 } }, question: { id: 'q2', title: 'Q2' } },
                ],
                paging: { is_end: true },
            };
        });
        await expect(cmd.func({ goto: vi.fn().mockResolvedValue(undefined), evaluate }, { user: 'wen-jie-16-47', limit: 2 })).resolves.toEqual([
            { rank: 1, question: 'Q1', votes: 10, comments: 12, created: 1780888788, url: 'https://www.zhihu.com/question/q1/answer/a1' },
            { rank: 2, question: 'Q2', votes: 3, comments: 0, created: 0, url: 'https://www.zhihu.com/question/q2/answer/a2' },
        ]);
    });

    it('maps 403 to AuthRequiredError', async () => {
        const cmd = getRegistry().get('zhihu/user-answers');
        const page = { goto: vi.fn().mockResolvedValue(undefined), evaluate: vi.fn().mockResolvedValue({ __httpError: 403 }) };
        await expect(cmd.func(page, { user: 'foo', limit: 2 })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('unwraps Browser Bridge envelopes and fails typed on malformed answer identity', async () => {
        const cmd = getRegistry().get('zhihu/user-answers');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ session: {}, data: { data: [{ id: 'a1', question: { title: 'missing id' } }], paging: { is_end: true } } }),
        };
        await expect(cmd.func(page, { user: 'foo', limit: 2 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws EmptyResultError for valid empty answer lists', async () => {
        const cmd = getRegistry().get('zhihu/user-answers');
        const page = { goto: vi.fn().mockResolvedValue(undefined), evaluate: vi.fn().mockResolvedValue({ data: [], paging: { is_end: true } }) };
        await expect(cmd.func(page, { user: 'foo', limit: 2 })).rejects.toBeInstanceOf(EmptyResultError);
    });

    it('rejects pagination next URLs that drift to another member endpoint', async () => {
        const cmd = getRegistry().get('zhihu/user-answers');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({
                data: [{ id: 'a1', question: { id: 'q1', title: 'Q1' } }],
                paging: {
                    is_end: false,
                    next: 'https://www.zhihu.com/api/v4/members/foo/articles?offset=20',
                },
            }),
        };
        await expect(cmd.func(page, { user: 'foo', limit: 2 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('rejects invalid limits before navigation', async () => {
        const cmd = getRegistry().get('zhihu/user-answers');
        const page = { goto: vi.fn(), evaluate: vi.fn() };
        await expect(cmd.func(page, { user: 'foo', limit: 0 })).rejects.toBeInstanceOf(CliError);
        await expect(cmd.func(page, { user: 'foo', limit: '1e2' })).rejects.toBeInstanceOf(CliError);
        expect(page.goto).not.toHaveBeenCalled();
    });
});
