import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { __test__ } from './search.js';

const { buildSearchQuery, resolveSearchFParam, HAS_CHOICES, EXCLUDE_CHOICES, PRODUCT_CHOICES, EXCLUDE_TO_OPERATOR, PRODUCT_TO_F_PARAM, FROM_USER_PATTERN } = __test__;
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
    it('clicks the requested product tab after fallback navigation when f= param is absent', async () => {
        const command = getRegistry().get('twitter/search');
        expect(command?.func).toBeTypeOf('function');
        const evaluate = vi.fn()
            .mockResolvedValueOnce(undefined) // pushState attempt 1
            .mockResolvedValueOnce('/explore')
            .mockResolvedValueOnce(undefined) // pushState attempt 2
            .mockResolvedValueOnce('/explore')
            .mockResolvedValueOnce({ ok: true }) // search input fallback
            .mockResolvedValueOnce('/search')
            .mockResolvedValueOnce(true); // product tab click
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            installInterceptor: vi.fn().mockResolvedValue(undefined),
            evaluate,
            autoScroll: vi.fn().mockResolvedValue(undefined),
            getInterceptedRequests: vi.fn().mockResolvedValue([]),
        };
        const result = await command.func(page, { query: 'cats', product: 'photos', limit: 5 });
        expect(result).toEqual([]);
        expect(evaluate).toHaveBeenCalledTimes(7);
        expect(evaluate.mock.calls[6][0]).toContain('Photos');
        expect(page.autoScroll).toHaveBeenCalled();
    });
    it('throws when fallback navigation cannot select the requested product tab', async () => {
        const command = getRegistry().get('twitter/search');
        expect(command?.func).toBeTypeOf('function');
        const evaluate = vi.fn()
            .mockResolvedValueOnce(undefined) // pushState attempt 1
            .mockResolvedValueOnce('/explore')
            .mockResolvedValueOnce(undefined) // pushState attempt 2
            .mockResolvedValueOnce('/explore')
            .mockResolvedValueOnce({ ok: true }) // search input fallback
            .mockResolvedValueOnce('/search')
            .mockResolvedValueOnce(false); // requested tab missing
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            installInterceptor: vi.fn().mockResolvedValue(undefined),
            evaluate,
            autoScroll: vi.fn().mockResolvedValue(undefined),
            getInterceptedRequests: vi.fn(),
        };
        await expect(command.func(page, { query: 'cats', product: 'videos', limit: 5 }))
            .rejects
            .toThrow(/could not select the requested product tab: video/);
        expect(page.autoScroll).not.toHaveBeenCalled();
        expect(page.getInterceptedRequests).not.toHaveBeenCalled();
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

describe('twitter search filter helpers', () => {
    describe('buildSearchQuery', () => {
        it('returns the trimmed raw query when no filters are set', () => {
            expect(buildSearchQuery('  hello world  ', {})).toBe('hello world');
        });
        it('appends from: with leading @ stripped', () => {
            expect(buildSearchQuery('hello', { from: '@alice' })).toBe('hello from:alice');
        });
        it('preserves from: when caller passes a bare username', () => {
            expect(buildSearchQuery('hello', { from: 'alice' })).toBe('hello from:alice');
        });
        it('strips multiple leading @ characters from --from', () => {
            expect(buildSearchQuery('hi', { from: '@@bob' })).toBe('hi from:bob');
        });
        it('drops --from when it is whitespace-only', () => {
            expect(buildSearchQuery('hi', { from: '   ' })).toBe('hi');
        });
        it('rejects invalid --from usernames instead of injecting raw operators', () => {
            expect(() => buildSearchQuery('hi', { from: 'alice filter:links' })).toThrow(/Invalid --from/);
            expect(() => buildSearchQuery('hi', { from: 'alice/bob' })).toThrow(/Invalid --from/);
            expect(() => buildSearchQuery('hi', { from: '@' + 'a'.repeat(16) })).toThrow(/Invalid --from/);
        });
        it('appends filter:<has> for --has', () => {
            expect(buildSearchQuery('q', { has: 'images' })).toBe('q filter:images');
        });
        it('maps --exclude retweets to -filter:nativeretweets', () => {
            expect(buildSearchQuery('q', { exclude: 'retweets' })).toBe('q -filter:nativeretweets');
        });
        it('maps --exclude replies/media/links to their -filter operators', () => {
            expect(buildSearchQuery('q', { exclude: 'replies' })).toBe('q -filter:replies');
            expect(buildSearchQuery('q', { exclude: 'media' })).toBe('q -filter:media');
            expect(buildSearchQuery('q', { exclude: 'links' })).toBe('q -filter:links');
        });
        it('silently ignores unknown --exclude values', () => {
            // choices: ['replies','retweets','media','links'] — unknowns shouldn't appear
            // in real CLI use because the validator rejects them, but the helper still
            // guards via the EXCLUDE_TO_OPERATOR map lookup.
            expect(buildSearchQuery('q', { exclude: 'bogus' })).toBe('q');
        });
        it('composes multiple filter clauses in stable order: query → from → has → exclude', () => {
            expect(buildSearchQuery('hot take', {
                from: '@alice',
                has: 'media',
                exclude: 'retweets',
            })).toBe('hot take from:alice filter:media -filter:nativeretweets');
        });
        it('allows an empty raw query when filters are present', () => {
            expect(buildSearchQuery('', { from: 'alice' })).toBe('from:alice');
        });
        it('returns empty string when nothing useful is supplied', () => {
            expect(buildSearchQuery('', {})).toBe('');
            expect(buildSearchQuery('   ', {})).toBe('');
        });
        it('coerces nullish raw query into empty string', () => {
            expect(buildSearchQuery(null, { from: 'alice' })).toBe('from:alice');
            expect(buildSearchQuery(undefined, { from: 'alice' })).toBe('from:alice');
        });
    });

    describe('resolveSearchFParam', () => {
        it('defaults to top when neither product nor filter is set', () => {
            expect(resolveSearchFParam({})).toBe('top');
        });
        it('returns top when filter=top', () => {
            expect(resolveSearchFParam({ filter: 'top' })).toBe('top');
        });
        it('returns live when filter=live', () => {
            expect(resolveSearchFParam({ filter: 'live' })).toBe('live');
        });
        it('maps --product photos to image (Twitter URL singular form)', () => {
            expect(resolveSearchFParam({ product: 'photos' })).toBe('image');
        });
        it('maps --product videos to video (Twitter URL singular form)', () => {
            expect(resolveSearchFParam({ product: 'videos' })).toBe('video');
        });
        it('maps --product top|live straight through', () => {
            expect(resolveSearchFParam({ product: 'top' })).toBe('top');
            expect(resolveSearchFParam({ product: 'live' })).toBe('live');
        });
        it('lets --product win when both --product and --filter are set', () => {
            expect(resolveSearchFParam({ product: 'photos', filter: 'live' })).toBe('image');
            expect(resolveSearchFParam({ product: 'top', filter: 'live' })).toBe('top');
        });
        it('falls back to filter when --product is unknown', () => {
            // unknowns are blocked at the CLI validator layer; this is just defence
            expect(resolveSearchFParam({ product: 'bogus', filter: 'live' })).toBe('live');
            expect(resolveSearchFParam({ product: 'bogus' })).toBe('top');
        });
    });

    describe('choice surface', () => {
        it('exposes the documented HAS_CHOICES set', () => {
            expect(HAS_CHOICES).toEqual(['media', 'images', 'videos', 'links', 'replies']);
        });
        it('exposes the documented EXCLUDE_CHOICES set', () => {
            expect(EXCLUDE_CHOICES).toEqual(['replies', 'retweets', 'media', 'links']);
        });
        it('exposes the documented PRODUCT_CHOICES set', () => {
            expect(PRODUCT_CHOICES).toEqual(['top', 'live', 'photos', 'videos']);
        });
        it('keeps PRODUCT_TO_F_PARAM domain a strict subset of PRODUCT_CHOICES', () => {
            for (const choice of PRODUCT_CHOICES) {
                expect(PRODUCT_TO_F_PARAM[choice]).toBeTypeOf('string');
            }
        });
        it('keeps EXCLUDE_TO_OPERATOR domain a strict subset of EXCLUDE_CHOICES', () => {
            for (const choice of EXCLUDE_CHOICES) {
                expect(EXCLUDE_TO_OPERATOR[choice]).toMatch(/^-filter:/);
            }
        });
        it('keeps FROM_USER_PATTERN aligned with X handle syntax', () => {
            expect(FROM_USER_PATTERN.test('alice_123')).toBe(true);
            expect(FROM_USER_PATTERN.test('a'.repeat(15))).toBe(true);
            expect(FROM_USER_PATTERN.test('a'.repeat(16))).toBe(false);
            expect(FROM_USER_PATTERN.test('alice/bob')).toBe(false);
        });
    });
});

describe('twitter search end-to-end with new filters', () => {
    it('encodes the composed query and product=live into the f= URL param', async () => {
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
        await command.func(page, {
            query: 'breaking news',
            from: '@alice',
            has: 'images',
            exclude: 'retweets',
            product: 'live',
            limit: 5,
        });
        const pushStateCall = evaluate.mock.calls[0][0];
        // f=live wins because --product=live trumps the default --filter
        expect(pushStateCall).toContain('f=live');
        // composed query should be percent-encoded inside the URL
        const encoded = encodeURIComponent('breaking news from:alice filter:images -filter:nativeretweets');
        expect(pushStateCall).toContain(encoded);
    });
    it('throws ArgumentError when query and all filters are empty', async () => {
        const command = getRegistry().get('twitter/search');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            installInterceptor: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn(),
            autoScroll: vi.fn().mockResolvedValue(undefined),
            getInterceptedRequests: vi.fn(),
        };
        await expect(command.func(page, { query: '   ', limit: 5 }))
            .rejects
            .toThrow(/empty/i);
        expect(page.installInterceptor).not.toHaveBeenCalled();
    });
    it('throws ArgumentError for invalid --from before navigation', async () => {
        const command = getRegistry().get('twitter/search');
        const page = {
            goto: vi.fn(),
            wait: vi.fn(),
            installInterceptor: vi.fn(),
            evaluate: vi.fn(),
            autoScroll: vi.fn(),
            getInterceptedRequests: vi.fn(),
        };
        await expect(command.func(page, { query: 'hi', from: 'alice filter:links', limit: 5 }))
            .rejects
            .toThrow(/Invalid --from/);
        expect(page.goto).not.toHaveBeenCalled();
    });
    it('throws ArgumentError for invalid --limit before navigation', async () => {
        const command = getRegistry().get('twitter/search');
        const page = {
            goto: vi.fn(),
            wait: vi.fn(),
            installInterceptor: vi.fn(),
            evaluate: vi.fn(),
            autoScroll: vi.fn(),
            getInterceptedRequests: vi.fn(),
        };
        await expect(command.func(page, { query: 'hi', limit: 0 }))
            .rejects
            .toThrow(/--limit/);
        expect(page.goto).not.toHaveBeenCalled();
    });
    it('runs with only filters set (empty <query>)', async () => {
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
        const result = await command.func(page, { query: '', from: 'alice', limit: 5 });
        expect(result).toEqual([]);
        const pushStateCall = evaluate.mock.calls[0][0];
        expect(pushStateCall).toContain(encodeURIComponent('from:alice'));
    });
});
