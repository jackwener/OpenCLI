import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
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
        const evaluate = vi.fn()
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce('self-user')
            .mockResolvedValueOnce(false)
            .mockResolvedValueOnce({
                hostname: 'www.xiaohongshu.com',
                pathname: '/user/profile/self-user',
                href: 'https://www.xiaohongshu.com/user/profile/self-user?tab=fav&subTab=note',
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

    it('rejects invalid --limit before browser navigation', async () => {
        const page = createPageMock();

        await expect(command.func(page, { limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('maps collection login wall to AuthRequiredError', async () => {
        const page = createPageMock([], {
            evaluate: vi.fn().mockResolvedValueOnce(true),
        });

        await expect(command.func(page, { id: 'self-user', limit: 5 })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('maps collection login redirects to AuthRequiredError', async () => {
        const page = createPageMock([], {
            evaluate: vi.fn()
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce({
                    hostname: 'www.xiaohongshu.com',
                    pathname: '/login',
                    href: 'https://www.xiaohongshu.com/login',
                }),
        });

        await expect(command.func(page, { id: 'self-user', limit: 5 })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('fails closed when navigation lands on another profile', async () => {
        const page = createPageMock([], {
            evaluate: vi.fn()
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce({
                    hostname: 'www.xiaohongshu.com',
                    pathname: '/user/profile/other-user',
                    href: 'https://www.xiaohongshu.com/user/profile/other-user?tab=fav&subTab=note',
                }),
        });

        await expect(command.func(page, { id: 'self-user', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
        expect(page.getInterceptedRequests).not.toHaveBeenCalled();
    });

    it('fails closed when collection API rows lack signed note identity', async () => {
        const page = createPageMock([], {
            evaluate: vi.fn()
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce({
                    hostname: 'www.xiaohongshu.com',
                    pathname: '/user/profile/self-user',
                    href: 'https://www.xiaohongshu.com/user/profile/self-user?tab=fav&subTab=note',
                }),
            getInterceptedRequests: vi.fn().mockResolvedValueOnce([{
                data: { notes: [{ note_id: '662908190000000001007366' }] },
            }]),
        });

        await expect(command.func(page, { id: 'self-user', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('fails closed when interceptor captures are malformed', async () => {
        const page = createPageMock([], {
            evaluate: vi.fn()
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce({
                    hostname: 'www.xiaohongshu.com',
                    pathname: '/user/profile/self-user',
                    href: 'https://www.xiaohongshu.com/user/profile/self-user?tab=fav&subTab=note',
                }),
            getInterceptedRequests: vi.fn().mockResolvedValueOnce({ data: { notes: [] } }),
        });

        await expect(command.func(page, { id: 'self-user', limit: 5 })).rejects.toBeInstanceOf(CommandExecutionError);
    });
});
