import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { normalizeRedditPostId, parseExpandRounds } from './read.js';
import './read.js';

function makePage(result) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(result),
    };
}

function redditPostEnvelope(children) {
    return [
        {
            data: {
                children: [{
                    data: {
                        title: 'Post title',
                        selftext: '',
                        author: 'op',
                        score: 10,
                        is_self: true,
                    },
                }],
            },
        },
        { data: { children } },
    ];
}

function commentThing(id, body, parent = 't3_abc123', score = 1) {
    return {
        kind: 't1',
        data: {
            id,
            name: `t1_${id}`,
            parent_id: parent,
            author: id,
            score,
            body,
            replies: '',
        },
    };
}

function moreThing(id, children, parent = 't3_abc123', count = children.length) {
    return {
        kind: 'more',
        data: { id, parent_id: parent, children, count },
    };
}

function jsonResponse(payload, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: vi.fn().mockResolvedValue(payload),
    };
}

function makeRuntimePage(fetchImpl) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn(async (script) => {
            const previousFetch = globalThis.fetch;
            globalThis.fetch = fetchImpl;
            try {
                return await eval(script);
            } finally {
                globalThis.fetch = previousFetch;
            }
        }),
    };
}

describe('reddit read adapter', () => {
    const command = getRegistry().get('reddit/read');

    it('uses an ephemeral Reddit site tab by default', () => {
        expect(command?.browser).toBe(true);
        expect(command?.siteSession).toBeUndefined();
        expect(command?.columns).toEqual(['type', 'author', 'score', 'text']);
    });

    it('exposes the new --expand-more / --expand-rounds args', () => {
        const argNames = command.args.map((a) => a.name);
        expect(argNames).toContain('expand-more');
        expect(argNames).toContain('expand-rounds');
        const expandMore = command.args.find((a) => a.name === 'expand-more');
        expect(expandMore.type).toBe('bool');
        expect(expandMore.default).toBe(false);
        const rounds = command.args.find((a) => a.name === 'expand-rounds');
        expect(rounds.type).toBe('int');
        expect(rounds.default).toBe(2);
    });

    describe('normalizeRedditPostId', () => {
        it('accepts bare ids, t3 fullnames, and exact reddit post URLs', () => {
            expect(normalizeRedditPostId('1AbC23')).toBe('1abc23');
            expect(normalizeRedditPostId('t3_1AbC23')).toBe('1abc23');
            expect(normalizeRedditPostId('https://www.reddit.com/r/opencli/comments/1abc23/title_slug/?sort=top')).toBe('1abc23');
            expect(normalizeRedditPostId('https://www.reddit.com/r/opencli/comments/1abc23/title_slug/okf3s7u/?context=3')).toBe('1abc23');
            expect(normalizeRedditPostId('https://old.reddit.com/comments/1abc23/title_slug/')).toBe('1abc23');
        });

        it('rejects invalid or structurally loose post identities before navigation', () => {
            for (const bad of [
                '',
                't1_okf3s7u',
                'https://reddit.com.evil.com/r/opencli/comments/1abc23/title_slug/',
                'http://www.reddit.com/r/opencli/comments/1abc23/title_slug/',
                'https://www.reddit.com/r/opencli/comments/',
                'https://www.reddit.com/r/opencli/comments/1abc23/title_slug/okf3s7u/evil',
                'not/a/post',
            ]) {
                expect(() => normalizeRedditPostId(bad)).toThrow(ArgumentError);
            }
        });
    });

    describe('parseExpandRounds', () => {
        it('returns the default for absent input but throws on out-of-range / non-integer', () => {
            expect(parseExpandRounds(undefined)).toBe(2);
            expect(parseExpandRounds(null)).toBe(2);
            expect(parseExpandRounds('')).toBe(2);
            expect(parseExpandRounds(1)).toBe(1);
            expect(parseExpandRounds(5)).toBe(5);
            for (const bad of [0, -1, 6, 1.5, NaN, 'abc']) {
                expect(() => parseExpandRounds(bad)).toThrow(ArgumentError);
            }
        });
    });

    it('rejects a bad --expand-rounds BEFORE navigating', async () => {
        const page = makePage({ kind: 'ok', rows: [] });
        await expect(command.func(page, { 'post-id': 'abc123', 'expand-rounds': 99 }))
            .rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('rejects a bad post identity BEFORE navigating', async () => {
        const page = makePage({ kind: 'ok', rows: [] });
        await expect(command.func(page, { 'post-id': 'https://evil.test/r/x/comments/abc/title/' }))
            .rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('returns rows when the evaluate script reports kind=ok', async () => {
        const page = makePage({
            kind: 'ok',
            rows: [
                { type: 'POST', author: 'alice', score: 10, text: 'Title' },
                { type: 'L0', author: 'bob', score: 5, text: 'Comment' },
            ],
            expandMeta: { rounds: 0, fetched: 0, capped: false, errors: [] },
        });
        const result = await command.func(page, { 'post-id': 'abc123', limit: 5 });
        expect(page.goto).toHaveBeenCalledWith('https://www.reddit.com');
        expect(result).toEqual([
            { type: 'POST', author: 'alice', score: 10, text: 'Title' },
            { type: 'L0', author: 'bob', score: 5, text: 'Comment' },
        ]);
    });

    it('maps the five failure kinds to the right typed errors', async () => {
        await expect(command.func(makePage({ kind: 'inaccessible', detail: 'post 403' }), { 'post-id': 'abc123' }))
            .rejects.toBeInstanceOf(EmptyResultError);

        await expect(command.func(makePage({ kind: 'auth', detail: 'morechildren 401' }), { 'post-id': 'abc123' }))
            .rejects.toBeInstanceOf(AuthRequiredError);

        await expect(command.func(makePage({ kind: 'http', httpStatus: 503, where: '/comments/abc.json' }), { 'post-id': 'abc123' }))
            .rejects.toBeInstanceOf(CommandExecutionError);

        await expect(command.func(makePage({ kind: 'malformed', detail: 'no comment listing' }), { 'post-id': 'abc123' }))
            .rejects.toBeInstanceOf(CommandExecutionError);

        await expect(command.func(makePage({ kind: 'parser-drift', detail: 'walker drift' }), { 'post-id': 'abc123' }))
            .rejects.toBeInstanceOf(CommandExecutionError);

        await expect(command.func(makePage({ kind: 'expand-failed', detail: 'morechildren errors' }), { 'post-id': 'abc123' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws CommandExecutionError on an unknown envelope shape (no kind)', async () => {
        await expect(command.func(makePage({ random: 'stuff' }), { 'post-id': 'abc123' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func(makePage(null), { 'post-id': 'abc123' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('embeds expandMore=false by default and inlines flags into the evaluate script', async () => {
        const page = makePage({ kind: 'ok', rows: [], expandMeta: { rounds: 0, fetched: 0, capped: false, errors: [] } });
        await command.func(page, { 'post-id': 'xyz', sort: 'top', limit: 3 });
        const script = page.evaluate.mock.calls[0][0];
        expect(script).toContain('var expandMore = false');
        expect(script).toContain('var expandRounds = 2');
        expect(script).toContain('var sort = "top"');
        expect(script).toContain('var limit = 3');
        expect(script).toContain('var postId = "xyz"');
    });

    it('embeds expandMore=true and the requested expandRounds when --expand-more is on', async () => {
        const page = makePage({ kind: 'ok', rows: [], expandMeta: { rounds: 3, fetched: 12, capped: true, errors: [] } });
        await command.func(page, { 'post-id': 'xyz', 'expand-more': true, 'expand-rounds': 3 });
        const script = page.evaluate.mock.calls[0][0];
        expect(script).toContain('var expandMore = true');
        expect(script).toContain('var expandRounds = 3');
        // The /api/morechildren request body construction must be present in
        // the evaluate script (round-trips the link_id + children CSV).
        expect(script).toContain("'/api/morechildren'");
        expect(script).toContain("'api_type=json'");
        expect(script).toContain("encodeURIComponent(linkFullname)");
        expect(script).toContain("encodeURIComponent(batch.join(','))");
    });

    it('normalizes a full reddit URL before building the browser script', async () => {
        const page = makePage({ kind: 'ok', rows: [], expandMeta: { rounds: 0, fetched: 0, capped: false, errors: [] } });
        await command.func(page, { 'post-id': 'https://www.reddit.com/r/python/comments/1abc23/title_slug/' });
        const script = page.evaluate.mock.calls[0][0];
        expect(script).toContain('var postId = "1abc23"');
        expect(script).not.toContain('postIdRaw.match');
    });

    it('expands morechildren in the original tree position instead of appending to the parent', async () => {
        const fetchMock = vi.fn(async (url) => {
            if (String(url).startsWith('/comments/')) {
                return jsonResponse(redditPostEnvelope([
                    commentThing('a', 'A'),
                    moreThing('more_top', ['b', 'c']),
                    commentThing('d', 'D'),
                ]));
            }
            if (String(url) === '/api/morechildren') {
                return jsonResponse({
                    json: {
                        errors: [],
                        data: { things: [commentThing('b', 'B'), commentThing('c', 'C')] },
                    },
                });
            }
            throw new Error(`unexpected URL ${url}`);
        });
        const page = makeRuntimePage(fetchMock);

        const result = await command.func(page, {
            'post-id': 'abc123',
            'expand-more': true,
            limit: 10,
            replies: 10,
        });

        expect(result.map((row) => row.author)).toEqual(['op', 'a', 'b', 'c', 'd']);
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/morechildren',
            expect.objectContaining({
                method: 'POST',
                body: expect.stringContaining('link_id=t3_abc123'),
            }),
        );
    });

    it('fails expand-more when Reddit returns a child that cannot be placed in the requested tree', async () => {
        const fetchMock = vi.fn(async (url) => {
            if (String(url).startsWith('/comments/')) {
                return jsonResponse(redditPostEnvelope([moreThing('more_top', ['b'])]));
            }
            if (String(url) === '/api/morechildren') {
                return jsonResponse({
                    json: {
                        errors: [],
                        data: { things: [commentThing('b', 'B', 't3_other')] },
                    },
                });
            }
            throw new Error(`unexpected URL ${url}`);
        });
        const page = makeRuntimePage(fetchMock);

        await expect(command.func(page, {
            'post-id': 'abc123',
            'expand-more': true,
        })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('fails expand-more when Reddit omits a requested child instead of silently dropping the stub', async () => {
        const fetchMock = vi.fn(async (url) => {
            if (String(url).startsWith('/comments/')) {
                return jsonResponse(redditPostEnvelope([moreThing('more_top', ['b', 'c'])]));
            }
            if (String(url) === '/api/morechildren') {
                return jsonResponse({
                    json: {
                        errors: [],
                        data: { things: [commentThing('b', 'B')] },
                    },
                });
            }
            throw new Error(`unexpected URL ${url}`);
        });
        const page = makeRuntimePage(fetchMock);

        await expect(command.func(page, {
            'post-id': 'abc123',
            'expand-more': true,
        })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('uses 5-kind discriminated union keys that DO NOT collide with declared columns', () => {
        // Read the evaluate template once to assert the intermediate keys we
        // return on the browser side never name any of `type` / `author` /
        // `score` / `text` (the declared columns) — that pattern would
        // trigger the silent-column-drop audit.
        const page = makePage({ kind: 'ok', rows: [], expandMeta: { rounds: 0, fetched: 0, capped: false, errors: [] } });
        return command.func(page, { 'post-id': 'xyz' }).then(() => {
            const script = page.evaluate.mock.calls[0][0];
            // Each return shape uses kind / detail / httpStatus / where /
            // rows / expandMeta. None overlap with the four declared
            // columns. The walker IS allowed to push column-shaped row
            // objects into `rows` — that's the final shape, not an
            // intermediate one.
            expect(script).toContain("kind: 'inaccessible'");
            expect(script).toContain("kind: 'auth'");
            expect(script).toContain("kind: 'http'");
            expect(script).toContain("kind: 'malformed'");
            expect(script).toContain("kind: 'parser-drift'");
            expect(script).toContain("kind: 'expand-failed'");
            expect(script).toContain("kind: 'ok'");
        });
    });
});
