import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './feed.js';
import { buildFeedNoteUrl } from './feed.js';

const HOST = 'www.xiaohongshu.com';

/**
 * Minimal page mock: feed reads the store via a single page.evaluate call.
 * `evaluateResult` is what that evaluate resolves to (the store-read envelope).
 */
function createPageMock(evaluateResult) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(evaluateResult),
    };
}

function entry(id, overrides = {}) {
    return {
        id,
        title: `title-${id}`,
        type: 'normal',
        author: `author-${id}`,
        likes: '100',
        xsecToken: `tok-${id}`,
        ...overrides,
    };
}

describe('xiaohongshu/feed buildFeedNoteUrl', () => {
    it('appends xsec_token and an empty xsec_source when a token is present', () => {
        expect(buildFeedNoteUrl(HOST, 'abc123', 'TOK')).toBe(
            `https://${HOST}/explore/abc123?xsec_token=TOK&xsec_source=`,
        );
    });

    it('falls back to a bare /explore URL when the token is empty', () => {
        expect(buildFeedNoteUrl(HOST, 'abc123', '')).toBe(`https://${HOST}/explore/abc123`);
    });

    it('URL-encodes xsec_token instead of interpolating raw query text', () => {
        expect(buildFeedNoteUrl(HOST, 'abc123', 'a&b=c d')).toBe(
            `https://${HOST}/explore/abc123?xsec_token=a%26b%3Dc+d&xsec_source=`,
        );
    });
});

describe('xiaohongshu/feed func', () => {
    const feed = getRegistry().get('xiaohongshu/feed');

    beforeEach(() => {
        expect(feed).toBeDefined();
    });

    it('emits signed note URLs from the hydrated store', async () => {
        const page = createPageMock({ items: [entry('id1'), entry('id2')] });
        const rows = await feed.func(page, { limit: 20 });
        expect(rows).toEqual([
            { id: 'id1', title: 'title-id1', type: 'normal', author: 'author-id1', likes: '100', url: `https://${HOST}/explore/id1?xsec_token=tok-id1&xsec_source=` },
            { id: 'id2', title: 'title-id2', type: 'normal', author: 'author-id2', likes: '100', url: `https://${HOST}/explore/id2?xsec_token=tok-id2&xsec_source=` },
        ]);
    });

    it('unwraps Browser Bridge evaluate envelopes', async () => {
        const page = createPageMock({ session: { id: 's1' }, data: { items: [entry('id1')] } });
        const rows = await feed.func(page, { limit: 20 });
        expect(rows[0].url).toBe(`https://${HOST}/explore/id1?xsec_token=tok-id1&xsec_source=`);
    });

    it('typed-fails when a feed entry is missing its note token', async () => {
        const page = createPageMock({ items: [entry('id1', { xsecToken: '' })] });
        await expect(feed.func(page, { limit: 20 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('xsecToken'),
        });
    });

    it('truncates to --limit', async () => {
        const page = createPageMock({ items: [entry('a'), entry('b'), entry('c')] });
        const rows = await feed.func(page, { limit: 2 });
        expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
    });

    it('typed-fails when a feed entry is missing its note id', async () => {
        const page = createPageMock({ items: [entry(''), entry('keep')] });
        await expect(feed.func(page, { limit: 20 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('note id'),
        });
    });

    it('rejects invalid --limit before browser navigation', async () => {
        const page = createPageMock({ items: [] });
        await expect(feed.func(page, { limit: 0 })).rejects.toMatchObject({ code: 'ARGUMENT' });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('maps a store read failure to CommandExecutionError', async () => {
        const page = createPageMock({ error: 'no_pinia' });
        await expect(feed.func(page, { limit: 20 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('no_pinia'),
        });
    });

    it('maps an empty store to EmptyResultError', async () => {
        const page = createPageMock({ items: [] });
        await expect(feed.func(page, { limit: 20 })).rejects.toMatchObject({ code: 'EMPTY_RESULT' });
    });

    it('maps a malformed items payload to CommandExecutionError', async () => {
        const page = createPageMock({ items: {} });
        await expect(feed.func(page, { limit: 20 })).rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    });

    it('reads the note token from the entry top level, not card.user', async () => {
        // entry.xsecToken is the note's token; card.user.xsecToken is the
        // author profile's — the func must not confuse them.
        const item = entry('id1', { xsecToken: 'note-token' });
        const page = createPageMock({ items: [item] });
        const rows = await feed.func(page, { limit: 20 });
        expect(rows[0].url).toContain('xsec_token=note-token');
    });
});
