import { describe, expect, it } from 'vitest';
import { ArgumentError, AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    buildCollectorJs,
    extractPosts,
    ingestPayloadText,
    isoDate,
    oneLine,
    parseLimit,
    parsePostTarget,
    parseUsername,
    postRows,
    RELATED_KEYS,
    requireRows,
    searchRows,
    searchUrl,
    userRows,
} from './utils.js';

function post({ pk, code, user, text = '', likes = 0, replies = 0, isReply = false, replyTo, takenAt = 1_790_000_000 }) {
    return {
        pk,
        code,
        user: { username: user, pk: `u${pk}` },
        caption: text ? { text } : null,
        like_count: likes,
        taken_at: takenAt,
        text_post_app_info: {
            is_reply: isReply,
            direct_reply_count: replies,
            repost_count: 1,
            quote_count: 0,
            reply_to_author: replyTo ? { username: replyTo } : null,
        },
    };
}

/** Shape observed on a post page: main media, direct_replies, relatedPosts. */
function postPageFixture() {
    return {
        require: [['RelayPrefetchedStreamCache', 'next', [], ['adp_x', {
            __bbox: {
                result: {
                    data: {
                        media: post({ pk: '1', code: 'MAIN1', user: 'alice', text: 'Main  post\ntext', replies: 2, takenAt: 100 }),
                        direct_replies: { edges: [
                            { node: { posts: { edges: [{ node: post({ pk: '3', code: 'R2', user: 'carol', text: 'second', isReply: true, replyTo: 'alice', takenAt: 300 }) }] } } },
                            { node: { posts: { edges: [{ node: post({ pk: '2', code: 'R1', user: 'alice', text: 'author follow-up', isReply: true, replyTo: 'alice', takenAt: 200 }) }] } } },
                        ] },
                        relatedPosts: { threads: [{ thread_items: [{ post: post({ pk: '9', code: 'REL', user: 'spam', text: 'related', isReply: true, takenAt: 500 }) }] }] },
                    },
                },
            },
        }]]],
    };
}

describe('threads payload extraction', () => {
    it('collects post-shaped nodes and flags related subtrees', () => {
        const posts = [...extractPosts(postPageFixture(), new Map(), RELATED_KEYS).values()];
        expect(posts.map((p) => [p.code, p.related])).toEqual([
            ['MAIN1', false],
            ['R2', false],
            ['R1', false],
            ['REL', true],
        ]);
        expect(posts[1]).toMatchObject({ author: 'carol', is_reply: true, reply_to: 'alice', reposts: 1 });
    });

    it('prefers a non-related sighting of the same pk', () => {
        const posts = new Map();
        extractPosts({ relatedPosts: [post({ pk: '5', code: 'X', user: 'bob', text: 'x' })] }, posts, RELATED_KEYS);
        expect(posts.get('5').related).toBe(true);
        extractPosts({ edges: [post({ pk: '5', code: 'X', user: 'bob', text: 'x' })] }, posts, RELATED_KEYS);
        expect(posts.get('5').related).toBe(false);
    });

    it('decodes guarded and newline-delimited GraphQL bodies', () => {
        const posts = new Map();
        const a = JSON.stringify({ data: { node: post({ pk: '1', code: 'A', user: 'a', text: 'one' }) } });
        const b = JSON.stringify({ data: { node: post({ pk: '2', code: 'B', user: 'b', text: 'two' }) } });
        ingestPayloadText(`for (;;);${a}\n${b}`, posts, RELATED_KEYS, extractPosts);
        ingestPayloadText('{"no":"posts here"}', posts, RELATED_KEYS, extractPosts);
        ingestPayloadText('not json "caption"', posts, RELATED_KEYS, extractPosts);
        expect([...posts.keys()]).toEqual(['1', '2']);
    });

    it('embeds the shared extractor in the collector script', () => {
        const js = buildCollectorJs({ limit: 5, scrolls: 2 });
        expect(js).toContain('const extractPosts = function extractPosts');
        expect(js).toContain('const LIMIT = 5;');
        expect(js).toContain('["relatedPosts"]');
        expect(() => new Function(`return ${js.trim()}`)).not.toThrow();
    });
});

describe('threads row shaping', () => {
    const posts = [...extractPosts(postPageFixture(), new Map(), RELATED_KEYS).values()];

    it('returns the main post followed by replies in time order', () => {
        const rows = postRows(posts, 'MAIN1', 10);
        expect(rows.map((r) => [r.type, r.author])).toEqual([
            ['post', 'alice'],
            ['author-reply', 'alice'],
            ['reply', 'carol'],
        ]);
        expect(rows[0]).toMatchObject({
            text: 'Main post text',
            url: 'https://www.threads.com/@alice/post/MAIN1',
            published_at: '1970-01-01T00:01:40Z',
        });
        expect(postRows(posts, 'MAIN1', 1)).toHaveLength(2);
        expect(postRows(posts, 'MISSING', 10)).toEqual([]);
    });

    it('drops related posts from search results', () => {
        const rows = searchRows(posts, 10);
        expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
        expect(rows.some((r) => r.author === 'spam')).toBe(false);
    });

    it('keeps only the requested author and hides replies by default', () => {
        expect(userRows(posts, 'ALICE', 10, false).map((r) => r.url)).toEqual([
            'https://www.threads.com/@alice/post/MAIN1',
        ]);
        expect(userRows(posts, 'alice', 10, true).map((r) => r.is_reply)).toEqual([true, false]);
    });
});

describe('threads argument parsing', () => {
    it('parses post URLs and shortcodes', () => {
        expect(parsePostTarget('https://www.threads.net/@a.b/post/Dd8ZIkwiNKQ?x=1')).toEqual({
            url: 'https://www.threads.com/@a.b/post/Dd8ZIkwiNKQ',
            code: 'Dd8ZIkwiNKQ',
        });
        expect(parsePostTarget('Dd8ZIkwiNKQ')).toEqual({ url: 'https://www.threads.com/t/Dd8ZIkwiNKQ', code: 'Dd8ZIkwiNKQ' });
        expect(() => parsePostTarget('https://example.com/x')).toThrow(ArgumentError);
    });

    it('parses usernames', () => {
        expect(parseUsername('@zuck')).toBe('zuck');
        expect(parseUsername('https://www.threads.com/@mosseri/replies')).toBe('mosseri');
        expect(() => parseUsername('bad name')).toThrow(ArgumentError);
    });

    it('validates limits', () => {
        expect(parseLimit(undefined, 20)).toBe(20);
        expect(parseLimit('5', 20)).toBe(5);
        expect(parseLimit(0, 30, { min: 0 })).toBe(0);
        expect(() => parseLimit(0, 20)).toThrow(ArgumentError);
        expect(() => parseLimit(101, 20)).toThrow(ArgumentError);
    });

    it('builds search URLs', () => {
        expect(searchUrl('a b', 'top')).toBe('https://www.threads.com/search?q=a%20b&serp_type=default');
        expect(searchUrl('x', 'recent')).toBe('https://www.threads.com/search?q=x&serp_type=default&filter=recent');
    });
});

describe('threads helpers', () => {
    it('maps empty results to typed errors', () => {
        const raw = { posts: [{ pk: '1' }] };
        expect(() => requireRows([], { ...raw, loginLink: true }, 'search')).toThrow(AuthRequiredError);
        expect(() => requireRows([], { ...raw, loginLink: false }, 'search')).toThrow(EmptyResultError);
        expect(() => requireRows([], { posts: [], loginLink: false }, 'user', 'No posts by @x'))
            .toThrow(expect.objectContaining({ code: 'EMPTY_RESULT', hint: 'No posts by @x' }));
        expect(requireRows([{ rank: 1 }], { posts: [], loginLink: true }, 'search')).toEqual([{ rank: 1 }]);
    });

    it('formats text and dates', () => {
        expect(oneLine('a\n\n b   c')).toBe('a b c');
        expect(oneLine('abcdef', 4)).toBe('abc…');
        expect(isoDate(0)).toBe('');
        expect(isoDate(1_790_862_059)).toBe('2026-10-01T13:40:59Z');
    });
});
