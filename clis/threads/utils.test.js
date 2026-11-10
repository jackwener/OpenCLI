import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ArgumentError, AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    buildCollectorJs,
    selectPosts,
    createStore,
    ingestDocument,
    ingestPayloadText,
    isoDate,
    oneLine,
    parseLimit,
    parsePostTarget,
    parseUsername,
    postRows,
    requireRows,
    searchRows,
    searchUrl,
    userRows,
} from './utils.js';

/**
 * Fixtures are sanitized captures of real threads.com pages (logged in): users,
 * shortcodes, ids, text and cursors are placeholders; the wrappers, containers
 * and page_info nesting are unchanged. Each file holds the embedded script-tag
 * documents ("scripts", in page order) and XHR GraphQL bodies ("xhr", in arrival order).
 *   search.json   first page + one paginated searchResults response
 *   profile.json  first page + two paginated mediaData responses
 *   post.json     main post, streamed direct_replies script, one /api/graphql reply page
 */
const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));

function ingest(name, mutate = (doc) => doc) {
    const store = createStore();
    const f = fixture(name);
    for (const doc of f.scripts) ingestDocument(mutate(structuredClone(doc)), store);
    for (const doc of f.xhr) ingestPayloadText(JSON.stringify(mutate(structuredClone(doc))), store, ingestDocument);
    return { store, posts: [...store.posts.values()] };
}

const codes = (rows) => rows.map((r) => r.url.split('/').pop());

describe('threads search payloads', () => {
    it('reads only searchResults thread_items and keeps delivery order', () => {
        const { posts, store } = ingest('search');
        expect(posts.every((p) => p.kind === 'search')).toBe(true);
        expect(codes(searchRows(posts, 10))).toEqual(['CODE01', 'CODE02', 'CODE03', 'CODE04', 'CODE05']);
        expect(searchRows(posts, 2).map((r) => r.rank)).toEqual([1, 2]);
        expect(store.pages.search).toEqual({ hasNext: true, cursor: 'CURSOR_03' });
    });

    it('dedupes a post delivered again by the paginated response', () => {
        const f = fixture('search');
        const nodes = (doc) => JSON.stringify(doc).split('"caption"').length - 1;
        expect(nodes(f.scripts) + nodes(f.xhr)).toBe(6);
        expect(ingest('search').posts).toHaveLength(5);
    });
});

describe('threads profile payloads', () => {
    it('reads mediaData thread_items in server order and filters by author', () => {
        const { posts, store } = ingest('profile');
        expect(posts.every((p) => p.kind === 'profile')).toBe(true);
        const own = userRows(posts, 'USER_02', 50, true);
        expect(codes(own)).toEqual(posts.map((p) => p.code));
        expect(userRows(posts, 'user_02', 50, false).every((r) => !r.is_reply)).toBe(true);
        expect(userRows(posts, 'user_02', 50, false).length).toBeLessThan(own.length);
        expect(store.pages.profile.hasNext).toBe(true);
    });

    it('does not return another profile as the requested user', () => {
        expect(userRows(ingest('profile').posts, 'someone_else', 10, true)).toEqual([]);
    });
});

describe('threads post payloads', () => {
    it('returns the requested post followed by its direct replies in delivery order', () => {
        const { posts, store } = ingest('post');
        const rows = postRows(posts, 'CODE01', 50);
        expect(rows[0]).toMatchObject({ type: 'post', author: 'user_02', url: 'https://www.threads.com/@user_02/post/CODE01' });
        expect(codes(rows.slice(1))).toEqual(posts.filter((p) => p.kind === 'reply').map((p) => p.code));
        expect(rows.slice(1).every((r) => r.type === 'reply' || r.type === 'author-reply')).toBe(true);
        expect(postRows(posts, 'CODE01', 3)).toHaveLength(4);
        expect(store.pages.reply.hasNext).toBe(true);
    });

    it('requires the main post identity', () => {
        const { posts } = ingest('post');
        expect(postRows(posts, 'CODE02', 10)).toEqual([]);
        expect(postRows(posts, 'MISSING', 10)).toEqual([]);
    });

    it('dedupes streamed documents that arrive twice', () => {
        const f = fixture('post');
        const store = createStore();
        for (const doc of [...f.scripts, ...f.scripts]) ingestDocument(structuredClone(doc), store);
        for (const doc of [...f.xhr, ...f.xhr]) ingestPayloadText(JSON.stringify(doc), store, ingestDocument);
        expect(store.posts.size).toBe(ingest('post').store.posts.size);
    });

    it('ignores relatedPosts and other recommendation modules under data', () => {
        const related = {
            threads: [{ thread_items: [{ post: { pk: '1', code: 'REL', user: { username: 'spam' }, caption: { text: 'rec' }, text_post_app_info: { is_reply: true } } }] }],
        };
        const { posts } = ingest('post', (doc) => {
            const data = doc.require?.[0]?.[3]?.[0]?.__bbox?.require?.[0]?.[3]?.[0]?.__bbox?.result?.data;
            if (data?.media && !data.media.text_post_app_info?.direct_replies) {
                data.relatedPosts = related;
                data.recommended = related;
            }
            return doc;
        });
        expect(posts.map((p) => p.code)).not.toContain('REL');
        expect(postRows(posts, 'CODE01', 50).map((r) => r.author)).not.toContain('spam');
    });

    it('does not attach replies that belong to another post', () => {
        const { posts } = ingest('post', (doc) => {
            const walk = (n) => {
                if (Array.isArray(n)) n.forEach(walk);
                else if (n && typeof n === 'object') {
                    if (n.media && !n.media.pk) n.media.id = 'OTHER_MEDIA_ID';
                    Object.values(n).forEach(walk);
                }
            };
            walk(doc);
            return doc;
        });
        expect(postRows(posts, 'CODE01', 10)).toHaveLength(1);
    });
});

describe('threads payload decoding', () => {
    it('decodes guarded and newline-delimited GraphQL bodies', () => {
        const store = createStore();
        const node = (pk, code) => ({ pk, code, user: { username: code }, caption: { text: code } });
        const a = JSON.stringify({ data: { searchResults: { edges: [{ node: { thread: { thread_items: [{ post: node('1', 'A') }] } } }] } } });
        const b = JSON.stringify({ data: { searchResults: { edges: [{ node: { thread: { thread_items: [{ post: node('2', 'B') }] } } }] } } });
        ingestPayloadText(`for (;;);${a}\n${b}`, store, ingestDocument);
        ingestPayloadText('{"no":"posts here"}', store, ingestDocument);
        ingestPayloadText('not json "caption"', store, ingestDocument);
        expect([...store.posts.keys()]).toEqual(['1', '2']);
    });

    it('embeds the shared extractor in a parseable collector script', () => {
        const js = buildCollectorJs({ limit: 5, scrolls: 2, kind: 'search' });
        expect(js).toContain('const ingestDocument = function ingestDocument');
        expect(js).toContain('const LIMIT = 5;');
        expect(js).toContain('const KIND = "search";');
        expect(() => new Function(`return ${js.trim()}`)).not.toThrow();
    });
});

describe('threads partial results and blocking', () => {
    const rows = [{ rank: 1 }, { rank: 2 }];

    it('warns when pagination stopped before the limit', () => {
        const warnings = [];
        const warn = (m) => warnings.push(m);
        expect(requireRows(rows, { stop: 'stalled' }, 'search', undefined, 5, warn)).toBe(rows);
        requireRows(rows, { stop: 'scroll_cap' }, 'search', undefined, 5, warn);
        requireRows(rows, { stop: 'blocked', blocked: 'rate_limit' }, 'search', undefined, 5, warn);
        requireRows(rows, { stop: 'blocked', blocked: 'challenge' }, 'search', undefined, 5, warn);
        expect(warnings).toHaveLength(4);
        expect(warnings[0]).toContain('2 of 5');
        expect(warnings[2]).toContain('429');
    });

    it('stays quiet when the feed is exhausted or the limit was reached', () => {
        const warnings = [];
        const warn = (m) => warnings.push(m);
        requireRows(rows, { stop: 'exhausted' }, 'search', undefined, 5, warn);
        requireRows(rows, { stop: 'limit' }, 'search', undefined, 2, warn);
        expect(warnings).toEqual([]);
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
        expect(() => requireRows([], { ...raw, blocked: 'rate_limit' }, 'search'))
            .toThrow(expect.objectContaining({ code: 'COMMAND_EXEC', message: expect.stringContaining('429') }));
        expect(() => requireRows([], { ...raw, blocked: 'challenge' }, 'search'))
            .toThrow(expect.objectContaining({ code: 'COMMAND_EXEC', message: expect.stringContaining('challenge') }));
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

describe('threads matching before the limit', () => {
    const p = (o) => ({ pk: o.pk, code: o.pk, author: 'x', is_reply: false, media_id: '', parent: '', ...o });

    it('counts only posts that belong to the requested profile', () => {
        const posts = [
            p({ pk: '1', kind: 'profile', author: 'other' }),
            p({ pk: '2', kind: 'profile', author: 'me', is_reply: true }),
            p({ pk: '3', kind: 'profile', author: 'Me' }),
        ];
        expect(selectPosts(posts, { kind: 'profile', author: 'me', withReplies: false }).map((x) => x.pk)).toEqual(['3']);
        expect(selectPosts(posts, { kind: 'profile', author: 'me', withReplies: true }).map((x) => x.pk)).toEqual(['2', '3']);
    });

    it('counts a reply only when its parent is the requested post', () => {
        const posts = [
            p({ pk: 'm', code: 'MAIN01', kind: 'main', media_id: 'M_1' }),
            p({ pk: 'r1', kind: 'reply', parent: 'M_1' }),
            p({ pk: 'r2', kind: 'reply', parent: 'OTHER_9' }),
        ];
        expect(selectPosts(posts, { kind: 'reply', code: 'MAIN01' }).map((x) => x.pk)).toEqual(['r1']);
        expect(selectPosts(posts, { kind: 'reply', code: 'NOPE01' })).toEqual([]);
    });

    it('scopes the XHR hook to one run and restores it', () => {
        const js = buildCollectorJs({ limit: 5, scrolls: 2, kind: 'reply', code: 'MAIN01' });
        expect(js).toContain('proto.send = origSend;');
        expect(js).toContain('MAX_BUF');
        expect(js).not.toContain('__opencliThreadsBuf');
        expect(() => new Function(`return ${js.trim()}`)).not.toThrow();
    });
});
