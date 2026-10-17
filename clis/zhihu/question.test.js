import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';

import './question.js';
describe('zhihu question', () => {
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

});
