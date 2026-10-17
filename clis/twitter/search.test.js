import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { __test__ } from './search.js';

const { buildSearchQuery, resolveSearchFParam, resolveSearchProduct, buildSearchTimelineRequest, parseSearchTimeline, EXCLUDE_CHOICES, PRODUCT_CHOICES, EXCLUDE_TO_OPERATOR, PRODUCT_TO_F_PARAM, FROM_USER_PATTERN } = __test__;
describe('twitter search command', () => {
    it('paginates past the old five-page cap until the requested limit is reached', async () => {
        const command = getRegistry().get('twitter/search');
        let pageIndex = 0;
        const page = {
            getCookies: vi.fn().mockResolvedValue([{ name: 'ct0', value: 'csrf' }]),
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockImplementation(async () => {
                if (pageIndex === 0) {
                    pageIndex += 1;
                    return null;
                }
                const id = String(pageIndex);
                pageIndex += 1;
                return {
                    data: {
                        search_by_raw_query: {
                            search_timeline: {
                                timeline: {
                                    instructions: [
                                        {
                                            entries: [
                                                {
                                                    content: {
                                                        itemContent: {
                                                            tweet_results: {
                                                                result: {
                                                                    rest_id: id,
                                                                    legacy: { full_text: `tweet ${id}`, created_at: 'now' },
                                                                    core: { user_results: { result: { core: { screen_name: 'alice' } } } },
                                                                },
                                                            },
                                                        },
                                                    },
                                                },
                                                {
                                                    content: {
                                                        entryType: 'TimelineTimelineCursor',
                                                        cursorType: 'Bottom',
                                                        value: `cursor-${id}`,
                                                    },
                                                },
                                            ],
                                        },
                                    ],
                                },
                            },
                        },
                    },
                };
            }),
        };
        const result = await command.func(page, { query: 'opencli', limit: 7 });
        expect(result).toHaveLength(7);
        expect(result.map((row) => row.id)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
        expect(page.evaluate).toHaveBeenCalledTimes(8);
    });

    it('surfaces empty author when the tweet has no user screen_name', () => {
        const payload = {
            data: {
                search_by_raw_query: {
                    search_timeline: {
                        timeline: {
                            instructions: [{
                                type: 'TimelineAddEntries',
                                entries: [{
                                    entryId: 'tweet-2',
                                    content: {
                                        itemContent: {
                                            tweet_results: {
                                                result: {
                                                    rest_id: '2',
                                                    legacy: { full_text: 'no author here', favorite_count: 0, created_at: '' },
                                                    core: { user_results: { result: {} } },
                                                },
                                            },
                                        },
                                    },
                                }],
                            }],
                        },
                    },
                },
            },
        };
        const { rows } = parseSearchTimeline(payload, new Set());
        expect(rows).toHaveLength(1);
        expect(rows[0].author).toBe('');
        expect(rows[0].id).toBe('2');
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

        it('keeps FROM_USER_PATTERN aligned with X handle syntax', () => {
            expect(FROM_USER_PATTERN.test('alice_123')).toBe(true);
            expect(FROM_USER_PATTERN.test('a'.repeat(15))).toBe(true);
            expect(FROM_USER_PATTERN.test('a'.repeat(16))).toBe(false);
            expect(FROM_USER_PATTERN.test('alice/bob')).toBe(false);
        });
    });
});
