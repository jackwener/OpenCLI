import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { AuthRequiredError, CliError, CommandExecutionError } from '@jackwener/opencli/errors';
import './user-articles.js';

describe('zhihu user-articles', () => {
    it('maps a user articles list to rows', async () => {
        const cmd = getRegistry().get('zhihu/user-articles');
        expect(cmd?.func).toBeTypeOf('function');
        const evaluate = vi.fn().mockImplementation(async (js) => {
            expect(js).toContain('/api/v4/members/wen-jie-16-47/articles');
            return {
                data: [
                    { id: 'p1', title: 'Title 1', voteup_count: 5, comment_count: 2, created: 1775244581 },
                    { id: 'p2', title: 'Title 2', updated: 1775244999 },
                ],
                paging: { is_end: true },
            };
        });
        await expect(cmd.func({ goto: vi.fn().mockResolvedValue(undefined), evaluate }, { user: 'wen-jie-16-47', limit: 2 })).resolves.toEqual([
            { rank: 1, title: 'Title 1', votes: 5, comments: 2, created: 1775244581, url: 'https://zhuanlan.zhihu.com/p/p1' },
            { rank: 2, title: 'Title 2', votes: 0, comments: 0, created: 1775244999, url: 'https://zhuanlan.zhihu.com/p/p2' },
        ]);
    });

    it('maps 403 to AuthRequiredError', async () => {
        const cmd = getRegistry().get('zhihu/user-articles');
        const page = { goto: vi.fn().mockResolvedValue(undefined), evaluate: vi.fn().mockResolvedValue({ __httpError: 403 }) };
        await expect(cmd.func(page, { user: 'foo', limit: 2 })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('fails typed on malformed article identity rows', async () => {
        const cmd = getRegistry().get('zhihu/user-articles');
        const page = { goto: vi.fn().mockResolvedValue(undefined), evaluate: vi.fn().mockResolvedValue({ data: [{ id: 'p1' }], paging: { is_end: true } }) };
        await expect(cmd.func(page, { user: 'foo', limit: 2 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('rejects invalid limits before navigation', async () => {
        const cmd = getRegistry().get('zhihu/user-articles');
        const page = { goto: vi.fn(), evaluate: vi.fn() };
        await expect(cmd.func(page, { user: 'foo', limit: -1 })).rejects.toBeInstanceOf(CliError);
        expect(page.goto).not.toHaveBeenCalled();
    });
});
