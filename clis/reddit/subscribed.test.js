import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { parseRedditSubscribedLimit, unwrapEvaluateResult } from './subscribed.js';
import './subscribed.js';

function subredditThing(id, overrides = {}) {
    const displayName = `sub${id}`;
    return {
        kind: 't5',
        data: {
            id,
            name: `t5_${id}`,
            display_name: displayName,
            display_name_prefixed: `r/${displayName}`,
            title: `Sub ${id}`,
            subscribers: 1000,
            public_description: `Description ${id}`,
            url: `/r/${displayName}/`,
            ...overrides,
        },
    };
}

function makePage(result) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(result),
    };
}

describe('reddit subscribed adapter', () => {
    const command = getRegistry().get('reddit/subscribed');

    it('registers with id-bearing output columns', () => {
        expect(command).toBeDefined();
        expect(command.columns).toEqual(['id', 'subreddit', 'title', 'subscribers', 'description', 'url']);
    });

    it('parseRedditSubscribedLimit rejects out-of-range values without silent clamp', () => {
        expect(parseRedditSubscribedLimit(undefined)).toBe(100);
        expect(parseRedditSubscribedLimit(null)).toBe(100);
        expect(parseRedditSubscribedLimit('')).toBe(100);
        expect(parseRedditSubscribedLimit(1)).toBe(1);
        expect(parseRedditSubscribedLimit(1000)).toBe(1000);
        for (const bad of [0, -1, 1001, 1.5, NaN, 'abc']) {
            expect(() => parseRedditSubscribedLimit(bad)).toThrow(ArgumentError);
        }
    });

    it('rejects bad limit before navigation', async () => {
        const page = makePage({ kind: 'ok', entries: [] });
        await expect(command.func(page, { limit: 1001 })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('unwraps Browser Bridge envelopes', () => {
        const inner = { kind: 'ok', entries: [] };
        expect(unwrapEvaluateResult({ session: 'browser:default', data: inner })).toBe(inner);
        expect(unwrapEvaluateResult(inner)).toBe(inner);
    });

    it('returns subscribed subreddits from the browser-evaluated payload', async () => {
        const page = makePage({
            kind: 'ok',
            entries: [
                subredditThing('abc', {
                    display_name: 'programming',
                    display_name_prefixed: 'r/programming',
                    title: 'Programming',
                    subscribers: 6000000,
                    public_description: 'All things code',
                    url: '/r/programming/',
                }),
                subredditThing('def', {
                    display_name: 'MachineLearning',
                    display_name_prefixed: 'r/MachineLearning',
                    title: 'Machine Learning',
                    subscribers: 3000000,
                    public_description: 'ML research',
                    url: '/r/MachineLearning/',
                }),
            ],
        });
        const result = await command.func(page, { limit: 100 });
        expect(page.goto).toHaveBeenCalledWith('https://www.reddit.com');
        expect(result).toEqual([
            { id: 't5_abc', subreddit: 'r/programming', title: 'Programming', subscribers: 6000000, description: 'All things code', url: 'https://www.reddit.com/r/programming/' },
            { id: 't5_def', subreddit: 'r/MachineLearning', title: 'Machine Learning', subscribers: 3000000, description: 'ML research', url: 'https://www.reddit.com/r/MachineLearning/' },
        ]);
    });

    it('throws AuthRequiredError when not logged in', async () => {
        await expect(command.func(makePage({ kind: 'auth', detail: 'login required' }), { limit: 100 }))
            .rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('surfaces HTTP, malformed, exception, and unexpected envelopes as CommandExecutionError', async () => {
        await expect(command.func(makePage({ kind: 'http', httpStatus: 429, where: '/subreddits/mine/subscriptions.json?limit=100' }), { limit: 100 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func(makePage({ kind: 'malformed', detail: 'missing data.children' }), { limit: 100 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func(makePage({ kind: 'exception', detail: 'network' }), { limit: 100 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func(makePage({ ok: true }), { limit: 100 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws EmptyResultError for a valid empty subscriptions list', async () => {
        await expect(command.func(makePage({ kind: 'ok', entries: [] }), { limit: 100 }))
            .rejects.toBeInstanceOf(EmptyResultError);
    });

    it('throws CommandExecutionError when rows lack subreddit identity', async () => {
        await expect(command.func(makePage({ kind: 'ok', entries: [subredditThing('abc', { name: '', id: '', display_name: '', display_name_prefixed: '', url: '' })] }), { limit: 100 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('does not synthesize subreddit identity from a non-t5 listing item', async () => {
        await expect(command.func(makePage({
            kind: 'ok',
            entries: [{
                kind: 't3',
                data: {
                    id: 'abc',
                    display_name: 'notasub',
                    display_name_prefixed: 'r/notasub',
                    url: '/r/notasub/',
                },
            }],
        }), { limit: 100 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('respects --limit by slicing the final result', async () => {
        const page = makePage({ kind: 'ok', entries: Array.from({ length: 5 }, (_, i) => subredditThing(String(i))) });
        const result = await command.func(page, { limit: 3 });
        expect(result).toHaveLength(3);
        expect(result[0].subreddit).toBe('r/sub0');
    });

    it('embeds the validated limit literally in the browser script', async () => {
        const page = makePage({ kind: 'ok', entries: [subredditThing('x')] });
        await command.func(page, { limit: 7 });
        const script = page.evaluate.mock.calls[0][0];
        expect(script).toContain('const target = 7');
    });
});
