import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { createPageMock } from '../test-utils.js';
import './saved.js';

describe('xiaohongshu saved', () => {
    const command = getRegistry().get('xiaohongshu/saved');

    it('registers with navigateBefore=false', () => {
        expect(command).toBeDefined();
        expect(command.navigateBefore).toBe(false);
        expect(command.name).toBe('saved');
    });

    it('captures saved notes from the collect API', async () => {
        const intercepted = [
            {
                data: {
                    notes: [
                        {
                            note_id: '662908190000000001007366',
                            xsec_token: 'tok',
                            note_card: {
                                display_title: '收藏笔记',
                                type: 'normal',
                                user: { user_id: 'user-1', nickname: 'Me' },
                                interact_info: { liked_count: '8' },
                            },
                        },
                    ],
                },
            },
        ];
        const evaluate = vi.fn().mockResolvedValueOnce('self-user');
        const getInterceptedRequests = vi.fn()
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce(intercepted);
        const page = createPageMock([], {
            evaluate,
            getInterceptedRequests,
        });

        const result = await command.func(page, { limit: 5 });
        expect(result).toEqual([
            {
                rank: 1,
                id: '662908190000000001007366',
                title: '收藏笔记',
                author: 'Me',
                likes: '8',
                type: 'normal',
                url: 'https://www.xiaohongshu.com/user/profile/user-1/662908190000000001007366?xsec_token=tok&xsec_source=pc_user',
            },
        ]);
        expect(page.installInterceptor).toHaveBeenCalledWith('note/collect/page');
        expect(page.goto.mock.calls.at(-1)[0]).toBe('https://www.xiaohongshu.com/user/profile/self-user?tab=fav&subTab=note');
    });
});
