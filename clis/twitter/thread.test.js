import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { __test__ } from './thread.js';

describe('twitter thread parser', () => {
    it('extracts author bio from tweet user entity', () => {
        const command = getRegistry().get('twitter/thread');
        expect(command?.columns).toEqual(['id', 'author', 'author_avatar', 'bio', 'text', 'likes', 'retweets', 'views', 'url', 'has_media', 'media_urls', 'media_posters', 'media_durations', 'card', 'quoted_tweet', 'author_verified']);
        const result = __test__.parseTweetDetail({
            data: {
                threaded_conversation_with_injections_v2: {
                    instructions: [
                        {
                            entries: [
                                {
                                    content: {
                                        itemContent: {
                                            tweet_results: {
                                                result: {
                                                    rest_id: '1',
                                                    legacy: {
                                                        full_text: 'thread tweet',
                                                        favorite_count: 3,
                                                        retweet_count: 2,
                                                    },
                                                    core: {
                                                        user_results: {
                                                            result: {
                                                                legacy: {
                                                                    screen_name: 'alice',
                                                                    description: 'Thread author bio',
                                                                },
                                                            },
                                                        },
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
        }, new Set());
        expect(result.tweets).toHaveLength(1);
        expect(result.tweets[0]).toMatchObject({
            id: '1',
            author: 'alice',
            author_verified: false,
            bio: 'Thread author bio',
            text: 'thread tweet',
            likes: 3,
            retweets: 2,
            url: 'https://x.com/alice/status/1',
        });
    });
});

const tweetEntry = (id) => ({
    entryId: `tweet-${id}`,
    content: { itemContent: { tweet_results: { result: {
        rest_id: id,
        legacy: { full_text: `t${id}` },
        core: { user_results: { result: { legacy: { screen_name: 'u' } } } },
    } } } },
});
const cursorEntry = (kind, value) => ({ entryId: `cursor-${kind}-${value}`, content: { itemContent: { value } } });
const pageOf = (...entries) => ({ data: { threaded_conversation_with_injections_v2: { instructions: [{ entries }] } } });

function fakePage(pages) {
    const urls = [];
    return {
        urls,
        getCookies: async () => [{ name: 'ct0', value: 'token' }],
        evaluate: async (src) => {
            urls.push(decodeURIComponent(src.match(/fetchJsonOrLoginWall\("([^"]+)"/)[1]));
            return pages[urls.length - 1] ?? pageOf();
        },
    };
}
const runThread = (page, kwargs = {}) => getRegistry().get('twitter/thread').func(page, {
    'tweet-id': '1', limit: 50, 'top-by-engagement': 0, sort: 'relevance', ...kwargs,
});

describe('twitter thread pagination', () => {
    it('follows the "probable spam" ShowMoreThreads cursor', () => {
        const result = __test__.parseTweetDetail(pageOf(tweetEntry('1'), cursorEntry('showmorethreads', 'more')), new Set());
        expect(result.nextCursor).toBe('more');
    });

    it('reads past five pages and one empty page, and stops after two empty pages in a row', async () => {
        const pages = [];
        for (let i = 1; i <= 6; i++)
            pages.push(pageOf(tweetEntry(String(i)), cursorEntry('bottom', `p${i}`)));
        pages.push(pageOf(cursorEntry('showmorethreads', 'p7')));
        pages.push(pageOf(tweetEntry('7'), cursorEntry('bottom', 'p8')));
        pages.push(pageOf(cursorEntry('bottom', 'p9')));
        pages.push(pageOf(cursorEntry('bottom', 'p10')));
        const page = fakePage(pages);
        const rows = await runThread(page);
        expect(rows.map((r) => r.id)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
        expect(page.urls).toHaveLength(10);
        expect(page.urls[0]).toContain('"rankingMode":"Relevance"');
    });

    it('stops paging once --limit is reached', async () => {
        const page = fakePage([
            pageOf(tweetEntry('1'), tweetEntry('2'), cursorEntry('bottom', 'p1')),
            pageOf(tweetEntry('3'), cursorEntry('bottom', 'p2')),
        ]);
        const rows = await runThread(page, { limit: 2 });
        expect(rows.map((r) => r.id)).toEqual(['1', '2']);
        expect(page.urls).toHaveLength(1);
    });

    it('stops when X repeats a cursor', async () => {
        const page = fakePage([
            pageOf(tweetEntry('1'), cursorEntry('bottom', 'same')),
            pageOf(tweetEntry('2'), cursorEntry('bottom', 'same')),
        ]);
        await runThread(page);
        expect(page.urls).toHaveLength(2);
    });

    it('keeps newest-first order available with --sort recency', async () => {
        const page = fakePage([pageOf(tweetEntry('1'))]);
        await runThread(page, { sort: 'recency' });
        expect(page.urls[0]).toContain('"rankingMode":"Recency"');
    });
});
