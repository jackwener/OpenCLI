import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, AuthRequiredError, TimeoutError } from '@jackwener/opencli/errors';
import { __test__, searchCommand } from './search.js';

function createPageMock(result) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluateWithArgs: vi.fn().mockResolvedValue(result),
    };
}

describe('threads search helpers', () => {
    it('validates query and limit without silent clamping', () => {
        expect(__test__.normalizeQuery(' openai ')).toBe('openai');
        expect(__test__.normalizeLimit(undefined)).toBe(20);
        expect(__test__.normalizeLimit(50)).toBe(50);
        expect(() => __test__.normalizeQuery('  ')).toThrow(ArgumentError);
        expect(() => __test__.normalizeLimit(0)).toThrow(ArgumentError);
        expect(() => __test__.normalizeLimit(51)).toThrow(ArgumentError);
    });

    it('builds a conservative Threads search URL', () => {
        expect(__test__.buildSearchUrl('openai')).toBe('https://www.threads.com/search?q=openai&serp_type=default');
    });

    it('parses compact engagement counts', () => {
        expect(__test__.parseCompactCount('1,046')).toBe(1046);
        expect(__test__.parseCompactCount('1.5 万')).toBe(15000);
        expect(__test__.parseCompactCount('2.3K')).toBe(2300);
        expect(__test__.parseCompactCount('')).toBeNull();
        expect(__test__.parseCompactCount('reply')).toBeNull();
    });

    it('normalizes extracted rows to adapter columns', () => {
        const rows = __test__.normalizeExtractedRows([
            {
                username: 'openai',
                displayName: '',
                text: 'Research update',
                timestamp: '2026-04-15T00:00:00.000Z',
                url: 'https://www.threads.com/@openai/post/DXHjavPlGfH',
                replyCount: 10,
                repostCount: null,
                likeCount: 68,
            },
            { username: '', text: 'bad', url: 'https://example.com' },
        ], 20);
        expect(rows).toEqual([
            {
                rank: 1,
                username: 'openai',
                displayName: null,
                text: 'Research update',
                timestamp: '2026-04-15T00:00:00.000Z',
                url: 'https://www.threads.com/@openai/post/DXHjavPlGfH',
                replyCount: 10,
                repostCount: null,
                likeCount: 68,
            },
        ]);
    });
});

describe('threads search command', () => {
    it('navigates to search and returns extracted rows', async () => {
        const page = createPageMock({
            rows: [
                {
                    username: 'openai',
                    displayName: null,
                    text: 'Another season, another year of making history together.',
                    timestamp: '2026-04-15T00:00:00.000Z',
                    url: 'https://www.threads.com/@openai/post/DXHjavPlGfH',
                    replyCount: 10,
                    repostCount: 3,
                    likeCount: 68,
                },
            ],
        });

        const rows = await searchCommand.func(page, { query: 'openai', limit: 5 });
        expect(page.goto).toHaveBeenCalledWith(
            'https://www.threads.com/search?q=openai&serp_type=default',
            { allowBoundNavigation: true, settleMs: 2000 },
        );
        expect(page.evaluateWithArgs).toHaveBeenCalledWith(expect.any(String), { limit: 5 });
        expect(rows[0]).toMatchObject({ rank: 1, username: 'openai', likeCount: 68 });
    });

    it('reports auth-required when Threads shows a login wall', async () => {
        const page = createPageMock({ authRequired: true, rows: [] });
        await expect(searchCommand.func(page, { query: 'openai', limit: 5 })).rejects.toThrow(AuthRequiredError);
    });

    it('reports timeout when no rows render before the extractor deadline', async () => {
        const page = createPageMock({ timeout: true, rows: [] });
        await expect(searchCommand.func(page, { query: 'openai', limit: 5 })).rejects.toThrow(TimeoutError);
    });
});
