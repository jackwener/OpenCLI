import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './hot.js';
import './active.js';
import './newest.js';
import './tag.js';
import './read.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('lobsters listing adapters expose short_id and created_at', () => {
    const listings = ['lobsters/hot', 'lobsters/active', 'lobsters/newest', 'lobsters/tag'];

    listings.forEach((key) => {
        it(`${key} surfaces id (short_id) and created_at on every row`, () => {
            const cmd = getRegistry().get(key);
            expect(cmd?.columns).toEqual(['rank', 'id', 'title', 'score', 'author', 'comments', 'created_at', 'tags', 'url']);
            const mapStep = cmd?.pipeline?.find((step) => step.map);
            expect(mapStep?.map).toMatchObject({
                id: '${{ item.short_id }}',
                created_at: '${{ item.created_at }}',
                url: '${{ item.comments_url }}',
            });
        });
    });
});

describe('lobsters/read adapter', () => {
    const cmd = getRegistry().get('lobsters/read');

    it('registers the comment-thread shape (type/author/score/text)', () => {
        expect(cmd?.columns).toEqual(['type', 'author', 'score', 'text']);
    });

    it('takes a positional short_id plus tunable depth/limit/replies/max-length args', () => {
        const argNames = (cmd?.args || []).map((a) => a.name);
        expect(argNames).toEqual(['id', 'limit', 'depth', 'replies', 'max-length']);
        const idArg = cmd?.args?.find((a) => a.name === 'id');
        expect(idArg?.required).toBe(true);
        expect(idArg?.positional).toBe(true);
    });

    it('uses the public lobste.rs JSON endpoint (no browser, public strategy)', () => {
        expect(cmd?.browser).toBe(false);
        expect(cmd?.strategy).toBe('public');
    });

    it('fails fast with ArgumentError for non-alphanumeric short_id before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ id: 'BAD!ID', limit: 5, depth: 2, replies: 5, 'max-length': 2000 }))
            .rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fails fast with EmptyResultError on 404', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not found', { status: 404 })));

        await expect(cmd.func({ id: 'missing', limit: 5, depth: 2, replies: 5, 'max-length': 2000 }))
            .rejects.toThrow(EmptyResultError);
    });

    it('fails fast with ArgumentError when max-length is below the minimum before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ id: 'abc123', limit: 5, depth: 2, replies: 5, 'max-length': 99 }))
            .rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fails fast with CommandExecutionError on non-404 HTTP failures', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('oops', { status: 503 })));

        await expect(cmd.func({ id: 'abc123', limit: 5, depth: 2, replies: 5, 'max-length': 2000 }))
            .rejects.toThrow(CommandExecutionError);
    });

    it('builds a threaded tree from the flat comments[] using parent_comment', async () => {
        const story = {
            short_id: 'abc123',
            title: 'Hello world',
            url: 'https://example.com/post',
            score: 42,
            submitter_user: 'pg',
            description_plain: 'Some intro text.',
            comments_url: 'https://lobste.rs/s/abc123/hello_world',
            comments: [
                {
                    short_id: 'top1',
                    parent_comment: null,
                    score: 5,
                    commenting_user: 'alice',
                    comment_plain: 'Top one',
                    is_deleted: false,
                },
                {
                    short_id: 'reply1',
                    parent_comment: 'top1',
                    score: 3,
                    commenting_user: 'bob',
                    comment_plain: 'A reply',
                    is_deleted: false,
                },
                {
                    short_id: 'reply2',
                    parent_comment: 'top1',
                    score: 1,
                    commenting_user: 'carol',
                    comment_plain: 'Another reply',
                    is_deleted: false,
                },
                {
                    short_id: 'top2',
                    parent_comment: null,
                    score: 4,
                    commenting_user: 'dave',
                    comment_plain: 'Top two',
                    is_deleted: false,
                },
            ],
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(story), { status: 200 })));

        const rows = await cmd.func({ id: 'abc123', limit: 5, depth: 2, replies: 5, 'max-length': 2000 });

        expect(rows).toEqual([
            {
                type: 'POST',
                author: 'pg',
                score: 42,
                text: 'Hello world\nSome intro text.\nhttps://example.com/post',
            },
            { type: 'L0', author: 'alice', score: 5, text: 'Top one' },
            { type: 'L1', author: 'bob', score: 3, text: '  > A reply' },
            { type: 'L1', author: 'carol', score: 1, text: '  > Another reply' },
            { type: 'L0', author: 'dave', score: 4, text: 'Top two' },
        ]);
    });

    it('emits a "+N more replies" stub when depth cutoff hides children', async () => {
        const story = {
            short_id: 'abc123',
            title: 'Hi',
            url: '',
            score: 1,
            submitter_user: 'u',
            description_plain: '',
            comments: [
                { short_id: 't1', parent_comment: null, commenting_user: 'a', comment_plain: 'top', is_deleted: false },
                { short_id: 'r1', parent_comment: 't1', commenting_user: 'b', comment_plain: 'r', is_deleted: false },
            ],
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(story), { status: 200 })));

        const rows = await cmd.func({ id: 'abc123', limit: 5, depth: 1, replies: 5, 'max-length': 2000 });

        expect(rows).toEqual([
            { type: 'POST', author: 'u', score: 1, text: 'Hi' },
            { type: 'L0', author: 'a', score: '', text: 'top' },
            { type: 'L1', author: '', score: '', text: '  [+1 more replies]' },
        ]);
    });
});
