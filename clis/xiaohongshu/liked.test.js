import { describe, expect, it, vi } from 'vitest';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import { createPageMock } from '../test-utils.js';
import './liked.js';

describe('xiaohongshu liked', () => {
    const command = getRegistry().get('xiaohongshu/liked');

    it('registers with navigateBefore=false', () => {
        expect(command).toBeDefined();
        expect(command.navigateBefore).toBe(false);
        expect(command.name).toBe('liked');
    });

    it('captures liked notes from the like API', async () => {
        const intercepted = [
            {
                data: {
                    notes: [
                        {
                            note_id: '662908190000000001007367',
                            xsec_token: 'tok-2',
                            note_card: {
                                display_title: '赞过笔记',
                                type: 'video',
                                user: { user_id: 'user-2', nickname: 'Bob' },
                                interact_info: { liked_count: '99' },
                            },
                        },
                    ],
                },
            },
        ];
        const evaluate = vi.fn()
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce('self-user')
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce({
                hostname: 'www.xiaohongshu.com',
                pathname: '/user/profile/self-user',
                href: 'https://www.xiaohongshu.com/user/profile/self-user?tab=liked&subTab=note',
            });
        const getInterceptedRequests = vi.fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce(intercepted);
        const page = createPageMock([], {
            evaluate,
            getInterceptedRequests,
        });

        const result = await command.func(page, { limit: 1 });
        expect(result).toEqual([
            {
                rank: 1,
                id: '662908190000000001007367',
                title: '赞过笔记',
                author: 'Bob',
                likes: '99',
                type: 'video',
                url: 'https://www.xiaohongshu.com/user/profile/user-2/662908190000000001007367?xsec_token=tok-2&xsec_source=pc_user',
            },
        ]);
        expect(page.installInterceptor).toHaveBeenCalledWith('note/like/page');
        expect(page.goto.mock.calls.at(-1)[0]).toBe('https://www.xiaohongshu.com/user/profile/self-user?tab=liked&subTab=note');
    });

    it('fails closed when navigation lands on another profile', async () => {
        const page = createPageMock([], {
            evaluate: vi.fn()
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce({
                    hostname: 'www.xiaohongshu.com',
                    pathname: '/user/profile/other-user',
                    href: 'https://www.xiaohongshu.com/user/profile/other-user?tab=liked&subTab=note',
                }),
        });

        await expect(command.func(page, { id: 'self-user', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
        expect(page.getInterceptedRequests).not.toHaveBeenCalled();
    });
});
