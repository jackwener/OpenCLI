import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './search.js';
describe('twitter search command', () => {
    it('retries transient SPA navigation failures before giving up', async () => {
        const command = getRegistry().get('twitter/search');
        expect(command?.func).toBeTypeOf('function');
        const evaluate = vi.fn()
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce('/explore')
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce('/search');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            installInterceptor: vi.fn().mockResolvedValue(undefined),
            evaluate,
            autoScroll: vi.fn().mockResolvedValue(undefined),
            getInterceptedRequests: vi.fn().mockResolvedValue([
                {
                    data: {
                        search_by_raw_query: {
                            search_timeline: {
                                timeline: {
                                    instructions: [
                                        {
                                            type: 'TimelineAddEntries',
                                            entries: [
                                                {
                                                    entryId: 'tweet-1',
                                                    content: {
                                                        itemContent: {
                                                            tweet_results: {
                                                                result: {
                                                                    rest_id: '1',
                                                                    legacy: {
                                                                        full_text: 'hello world',
                                                                        favorite_count: 7,
                                                                        created_at: 'Thu Mar 26 10:30:00 +0000 2026',
                                                                    },
                                                                    core: {
                                                                        user_results: {
                                                                            result: {
                                                                                core: {
                                                                                    screen_name: 'alice',
                                                                                },
                                                                            },
                                                                        },
                                                                    },
                                                                    views: {
                                                                        count: '12',
                                                                    },
                                                                },
                                                            },
                                                        },
                                                    },
                                                },
                                            ],
                                        },
                                    ],
                                },
                            },
                        },
                    },
                },
            ]),
        };
        const result = await command.func(page, { query: 'from:alice', filter: 'top', limit: 5 });
        expect(result).toEqual([
            {
                id: '1',
                author: 'alice',
                text: 'hello world',
                created_at: 'Thu Mar 26 10:30:00 +0000 2026',
                likes: 7,
                views: '12',
                url: 'https://x.com/i/status/1',
                has_media: false,
                media_urls: [],
            },
        ]);
        expect(page.installInterceptor).toHaveBeenCalledWith('SearchTimeline');
        expect(evaluate).toHaveBeenCalledTimes(4);
    });
    it('uses f=live in search URL when filter is live', async () => {
        const command = getRegistry().get('twitter/search');
        const evaluate = vi.fn()
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce('/search');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            installInterceptor: vi.fn().mockResolvedValue(undefined),
            evaluate,
            autoScroll: vi.fn().mockResolvedValue(undefined),
            getInterceptedRequests: vi.fn().mockResolvedValue([]),
        };
        await command.func(page, { query: 'breaking news', filter: 'live', limit: 5 });
        const pushStateCall = evaluate.mock.calls[0][0];
        expect(pushStateCall).toContain('f=live');
        expect(pushStateCall).toContain(encodeURIComponent('breaking news'));
    });
    it('uses f=top in search URL when filter is top', async () => {
        const command = getRegistry().get('twitter/search');
        const evaluate = vi.fn()
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce('/search');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            installInterceptor: vi.fn().mockResolvedValue(undefined),
            evaluate,
            autoScroll: vi.fn().mockResolvedValue(undefined),
            getInterceptedRequests: vi.fn().mockResolvedValue([]),
        };
        await command.func(page, { query: 'test', filter: 'top', limit: 5 });
        const pushStateCall = evaluate.mock.calls[0][0];
        expect(pushStateCall).toContain('f=top');
    });
    it('falls back to top when filter is omitted', async () => {
        const command = getRegistry().get('twitter/search');
        const evaluate = vi.fn()
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce('/search');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            installInterceptor: vi.fn().mockResolvedValue(undefined),
            evaluate,
            autoScroll: vi.fn().mockResolvedValue(undefined),
            getInterceptedRequests: vi.fn().mockResolvedValue([]),
        };
        await command.func(page, { query: 'test', limit: 5 });
        const pushStateCall = evaluate.mock.calls[0][0];
        expect(pushStateCall).toContain('f=top');
    });
    it('falls back to search input when pushState fails twice', async () => {
        const command = getRegistry().get('twitter/search');
        expect(command?.func).toBeTypeOf('function');
        const evaluate = vi.fn()
            .mockResolvedValueOnce(undefined) // pushState attempt 1
            .mockResolvedValueOnce('/explore') // pathname check 1 — not /search
            .mockResolvedValueOnce(undefined) // pushState attempt 2
            .mockResolvedValueOnce('/explore') // pathname check 2 — still not /search
            .mockResolvedValueOnce({ ok: true }) // search input fallback succeeds
            .mockResolvedValueOnce('/search'); // pathname check after fallback
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            installInterceptor: vi.fn().mockResolvedValue(undefined),
            evaluate,
            autoScroll: vi.fn().mockResolvedValue(undefined),
            getInterceptedRequests: vi.fn().mockResolvedValue([
                {
                    data: {
                        search_by_raw_query: {
                            search_timeline: {
                                timeline: {
                                    instructions: [
                                        {
                                            type: 'TimelineAddEntries',
                                            entries: [
                                                {
                                                    entryId: 'tweet-99',
                                                    content: {
                                                        itemContent: {
                                                            tweet_results: {
                                                                result: {
                                                                    rest_id: '99',
                                                                    legacy: {
                                                                        full_text: 'fallback works',
                                                                        favorite_count: 3,
                                                                        created_at: 'Wed Apr 02 12:00:00 +0000 2026',
                                                                    },
                                                                    core: {
                                                                        user_results: {
                                                                            result: {
                                                                                core: { screen_name: 'bob' },
                                                                            },
                                                                        },
                                                                    },
                                                                    views: { count: '5' },
                                                                },
                                                            },
                                                        },
                                                    },
                                                },
                                            ],
                                        },
                                    ],
                                },
                            },
                        },
                    },
                },
            ]),
        };
        const result = await command.func(page, { query: 'test fallback', filter: 'top', limit: 5 });
        expect(result).toEqual([
            {
                id: '99',
                author: 'bob',
                text: 'fallback works',
                created_at: 'Wed Apr 02 12:00:00 +0000 2026',
                likes: 3,
                views: '5',
                url: 'https://x.com/i/status/99',
                has_media: false,
                media_urls: [],
            },
        ]);
        // 6 evaluate calls: 2x pushState + 2x pathname check + 1x fallback + 1x pathname check
        expect(evaluate).toHaveBeenCalledTimes(6);
        expect(page.autoScroll).toHaveBeenCalled();
    });
    it('throws with the final path after both attempts fail', async () => {
        const command = getRegistry().get('twitter/search');
        expect(command?.func).toBeTypeOf('function');
        const evaluate = vi.fn()
            .mockResolvedValueOnce(undefined) // pushState attempt 1
            .mockResolvedValueOnce('/explore') // pathname check 1
            .mockResolvedValueOnce(undefined) // pushState attempt 2
            .mockResolvedValueOnce('/login') // pathname check 2
            .mockResolvedValueOnce({ ok: false }); // search input fallback
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            installInterceptor: vi.fn().mockResolvedValue(undefined),
            evaluate,
            autoScroll: vi.fn().mockResolvedValue(undefined),
            getInterceptedRequests: vi.fn(),
        };
        await expect(command.func(page, { query: 'from:alice', filter: 'top', limit: 5 }))
            .rejects
            .toThrow('Final path: /login');
        expect(page.autoScroll).not.toHaveBeenCalled();
        expect(page.getInterceptedRequests).not.toHaveBeenCalled();
        expect(evaluate).toHaveBeenCalledTimes(5);
    });
});
