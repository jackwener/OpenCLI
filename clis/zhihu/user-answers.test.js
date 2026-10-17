import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import './user-answers.js';

describe('zhihu user-answers', () => {
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

});
