import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { parseRedditHomeLimit } from './home.js';
import './home.js';

function makePage(result) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(result),
    };
}

function makeEntry(id, overrides = {}) {
    return {
        data: {
            id,
            title: `Title for ${id}`,
            subreddit_name_prefixed: 'r/dummy',
            score: 100,
            num_comments: 10,
            author: 'someone',
            permalink: `/r/dummy/comments/${id}/title/`,
            ...overrides,
        },
    };
}

describe('reddit home command', () => {
    const command = getRegistry().get('reddit/home');

    it('registers with the expected shape', () => {
        expect(command).toBeDefined();
        expect(command.access).toBe('read');
        expect(command.browser).toBe(true);
        expect(command.columns).toEqual(['rank', 'title', 'subreddit', 'score', 'comments', 'postId', 'author', 'url']);
    });

    it('parseRedditHomeLimit accepts [1,100] and rejects out-of-range / non-integer without silent clamp', () => {
        expect(parseRedditHomeLimit(undefined)).toBe(25);
        expect(parseRedditHomeLimit(null)).toBe(25);
        expect(parseRedditHomeLimit('')).toBe(25);
        expect(parseRedditHomeLimit(1)).toBe(1);
        expect(parseRedditHomeLimit(25)).toBe(25);
        expect(parseRedditHomeLimit(100)).toBe(100);

        for (const bad of [0, -1, 101, 1.5, NaN, 'abc']) {
            expect(() => parseRedditHomeLimit(bad)).toThrow(ArgumentError);
        }
    });

    it('rejects a bad limit BEFORE navigating', async () => {
        const page = makePage({ kind: 'ok', entries: [] });
        await expect(command.func(page, { limit: 101 })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('throws AuthRequiredError when logged out (401/403 or missing identity)', async () => {
        await expect(command.func(makePage({ kind: 'auth', detail: 'login required' }), { limit: 25 }))
            .rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('throws CommandExecutionError on HTTP / exception failure modes', async () => {
        await expect(command.func(makePage({ kind: 'http', httpStatus: 503, where: '/best.json' }), { limit: 25 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func(makePage({ kind: 'exception', detail: 'network' }), { limit: 25 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws EmptyResultError when Reddit returns no posts', async () => {
        await expect(command.func(makePage({ kind: 'ok', entries: [] }), { limit: 25 }))
            .rejects.toBeInstanceOf(EmptyResultError);
    });

    it('maps entries to row shape with 1-based rank, full URLs, and typed numbers', async () => {
        const entries = [makeEntry('a1'), makeEntry('b2', { score: 250, num_comments: 42 })];
        const rows = await command.func(makePage({ kind: 'ok', entries }), { limit: 25 });

        expect(rows).toEqual([
            {
                rank: 1, title: 'Title for a1', subreddit: 'r/dummy', score: 100, comments: 10,
                postId: 'a1', author: 'someone', url: 'https://www.reddit.com/r/dummy/comments/a1/title/',
            },
            {
                rank: 2, title: 'Title for b2', subreddit: 'r/dummy', score: 250, comments: 42,
                postId: 'b2', author: 'someone', url: 'https://www.reddit.com/r/dummy/comments/b2/title/',
            },
        ]);
        // Row shape must match declared columns exactly.
        for (const row of rows) {
            expect(Object.keys(row).sort()).toEqual(
                ['author', 'comments', 'postId', 'rank', 'score', 'subreddit', 'title', 'url'],
            );
        }
    });

    it('applies the post-fetch limit slice (defence in depth vs Reddit overshoot)', async () => {
        const entries = Array.from({ length: 30 }, (_, i) => makeEntry(`p${i}`));
        const rows = await command.func(makePage({ kind: 'ok', entries }), { limit: 5 });
        expect(rows).toHaveLength(5);
        expect(rows[0].postId).toBe('p0');
        expect(rows[4].postId).toBe('p4');
    });

    it('drops entries with no data.id rather than silently emitting sentinels', async () => {
        const entries = [makeEntry('keep1'), { data: { title: 'no id' } }, makeEntry('keep2')];
        const rows = await command.func(makePage({ kind: 'ok', entries }), { limit: 25 });
        expect(rows.map((r) => r.postId)).toEqual(['keep1', 'keep2']);
    });

    it('throws CommandExecutionError when all home entries are missing post ids', async () => {
        const entries = [{ data: { title: 'no id' } }, { data: { title: 'also no id' } }];
        await expect(command.func(makePage({ kind: 'ok', entries }), { limit: 25 }))
            .rejects.toMatchObject({
                code: 'COMMAND_EXEC',
                message: expect.stringContaining('required post id anchors'),
            });
    });

    it('embeds the requested limit literally inside the evaluate script', async () => {
        const page = makePage({ kind: 'ok', entries: [makeEntry('x')] });
        await command.func(page, { limit: 7 });
        const script = page.evaluate.mock.calls[0][0];
        expect(script).toContain('const limit = 7');
    });
});
