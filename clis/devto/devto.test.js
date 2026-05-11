import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './top.js';
import './tag.js';
import './user.js';
import './read.js';

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('devto listing adapters surface id + reading_time + published_at', () => {
    it('devto/top has the agent-native column shape and pipeline mapping', () => {
        const cmd = getRegistry().get('devto/top');
        expect(cmd?.columns).toEqual([
            'rank', 'id', 'title', 'author', 'reactions', 'comments',
            'reading_time', 'published_at', 'tags', 'url',
        ]);
        const mapStep = cmd?.pipeline?.find((step) => step.map);
        expect(mapStep?.map).toMatchObject({
            id: '${{ item.id }}',
            reading_time: '${{ item.reading_time_minutes }}',
            published_at: '${{ item.published_at }}',
            url: '${{ item.url }}',
        });
    });

    it('devto/tag has the agent-native column shape and pipeline mapping', () => {
        const cmd = getRegistry().get('devto/tag');
        expect(cmd?.columns).toEqual([
            'rank', 'id', 'title', 'author', 'reactions', 'comments',
            'reading_time', 'published_at', 'tags', 'url',
        ]);
        const mapStep = cmd?.pipeline?.find((step) => step.map);
        expect(mapStep?.map).toMatchObject({
            id: '${{ item.id }}',
            reading_time: '${{ item.reading_time_minutes }}',
            published_at: '${{ item.published_at }}',
        });
    });

    it('devto/user has the agent-native column shape (no author column, since user-specific)', () => {
        const cmd = getRegistry().get('devto/user');
        expect(cmd?.columns).toEqual([
            'rank', 'id', 'title', 'reactions', 'comments',
            'reading_time', 'published_at', 'tags', 'url',
        ]);
        const mapStep = cmd?.pipeline?.find((step) => step.map);
        expect(mapStep?.map).toMatchObject({
            id: '${{ item.id }}',
            reading_time: '${{ item.reading_time_minutes }}',
            published_at: '${{ item.published_at }}',
        });
    });
});

describe('devto/read adapter', () => {
    const cmd = getRegistry().get('devto/read');

    it('registers the article-detail row shape', () => {
        expect(cmd?.columns).toEqual([
            'id', 'title', 'author', 'reactions', 'reading_time',
            'tags', 'published_at', 'body', 'url',
        ]);
    });

    it('takes a positional id plus a tunable max-length', () => {
        const argNames = (cmd?.args || []).map((a) => a.name);
        expect(argNames).toEqual(['id', 'max-length']);
        const idArg = cmd?.args?.find((a) => a.name === 'id');
        expect(idArg?.required).toBe(true);
        expect(idArg?.positional).toBe(true);
    });

    it('uses the public dev.to JSON endpoint (no browser, public strategy)', () => {
        expect(cmd?.browser).toBe(false);
        expect(cmd?.strategy).toBe('public');
    });

    it('fails fast with ArgumentError for non-numeric id before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ id: 'not-a-number', 'max-length': 20000 }))
            .rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fails fast with ArgumentError for max-length below 100 before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ id: '12345', 'max-length': 50 }))
            .rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('accepts numeric max-length strings on the direct func path', async () => {
        const article = {
            id: 1,
            title: 't',
            user: { username: 'u' },
            public_reactions_count: 0,
            reading_time_minutes: 1,
            tag_list: [],
            published_at: '',
            body_markdown: 'x'.repeat(150),
            url: 'https://dev.to/u/t-1',
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(article), { status: 200 })));

        const rows = await cmd.func({ id: '1', 'max-length': '100' });
        expect(rows[0].body).toBe('x'.repeat(100) + '\n\n... [truncated]');
    });

    it('fails fast with ArgumentError for invalid max-length strings before fetching', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(cmd.func({ id: '12345', 'max-length': 'abc' }))
            .rejects.toThrow(ArgumentError);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fails fast with EmptyResultError on 404', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not found', { status: 404 })));

        await expect(cmd.func({ id: '99999999', 'max-length': 20000 }))
            .rejects.toThrow(EmptyResultError);
    });

    it('fails fast with CommandExecutionError on non-404 HTTP failures', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Server error', { status: 500 })));

        await expect(cmd.func({ id: '12345', 'max-length': 20000 }))
            .rejects.toThrow(CommandExecutionError);
    });

    it('fails fast with CommandExecutionError on invalid JSON responses', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not json', { status: 200 })));

        await expect(cmd.func({ id: '12345', 'max-length': 20000 }))
            .rejects.toThrow(CommandExecutionError);
    });

    it('fails fast when the full article body is missing instead of returning a summary', async () => {
        const article = {
            id: 1,
            title: 't',
            user: { username: 'u' },
            public_reactions_count: 0,
            reading_time_minutes: 1,
            tag_list: [],
            published_at: '',
            description: 'summary only',
            url: 'https://dev.to/u/t-1',
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(article), { status: 200 })));

        await expect(cmd.func({ id: '1', 'max-length': 20000 }))
            .rejects.toThrow(CommandExecutionError);
    });

    it('returns a single article row with body_markdown extracted', async () => {
        // Real /api/articles/<id> returns tag_list as a comma string and tags as an array.
        const article = {
            id: 3605688,
            title: 'How to do thing X in Rust',
            user: { username: 'jdoe' },
            public_reactions_count: 42,
            reading_time_minutes: 7,
            tag_list: 'rust, webdev',
            tags: ['rust', 'webdev'],
            published_at: '2026-05-01T00:00:00Z',
            body_markdown: '# Hello\n\nThis is the article body.',
            url: 'https://dev.to/jdoe/how-to-do-thing-x-in-rust-1234',
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(article), { status: 200 })));

        const rows = await cmd.func({ id: '3605688', 'max-length': 20000 });

        expect(rows).toEqual([
            {
                id: 3605688,
                title: 'How to do thing X in Rust',
                author: 'jdoe',
                reactions: 42,
                reading_time: 7,
                tags: 'rust, webdev',
                published_at: '2026-05-01T00:00:00Z',
                body: '# Hello\n\nThis is the article body.',
                url: 'https://dev.to/jdoe/how-to-do-thing-x-in-rust-1234',
            },
        ]);
    });

    it('handles the alternate shape where tag_list is an array (defensive)', async () => {
        const article = {
            id: 1,
            title: 't',
            user: { username: 'u' },
            public_reactions_count: 0,
            reading_time_minutes: 1,
            tag_list: ['javascript', 'webdev'],
            published_at: '',
            body_markdown: 'body',
            url: 'https://dev.to/u/t-1',
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(article), { status: 200 })));

        const rows = await cmd.func({ id: '1', 'max-length': 20000 });
        expect(rows[0].tags).toBe('javascript, webdev');
    });

    it('truncates body when over max-length and appends a marker', async () => {
        const longBody = 'x'.repeat(500);
        const article = {
            id: 1,
            title: 't',
            user: { username: 'u' },
            public_reactions_count: 0,
            reading_time_minutes: 1,
            tag_list: [],
            published_at: '',
            body_markdown: longBody,
            url: 'https://dev.to/u/t-1',
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(article), { status: 200 })));

        const rows = await cmd.func({ id: '1', 'max-length': 100 });

        expect(rows[0].body).toBe('x'.repeat(100) + '\n\n... [truncated]');
    });
});
