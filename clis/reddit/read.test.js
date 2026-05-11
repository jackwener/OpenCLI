import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './read.js';
describe('reddit read adapter', () => {
    const command = getRegistry().get('reddit/read');
    it('opts into the Reddit persistent site session', () => {
        expect(command?.browser).toBe(true);
        expect(command?.siteSession).toBe('persistent');
    });
    it('returns threaded rows from the browser-evaluated payload', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue([
                { type: 'POST', author: 'alice', score: 10, text: 'Title' },
                { type: 'L0', author: 'bob', score: 5, text: 'Comment' },
            ]),
        };
        const result = await command.func(page, { 'post-id': 'abc123', limit: 5 });
        expect(page.goto).toHaveBeenCalledWith('https://www.reddit.com');
        expect(result).toEqual([
            { type: 'POST', author: 'alice', score: 10, text: 'Title' },
            { type: 'L0', author: 'bob', score: 5, text: 'Comment' },
        ]);
    });
    it('surfaces adapter-level API errors clearly', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ error: 'Reddit API returned HTTP 403' }),
        };
        await expect(command.func(page, { 'post-id': 'abc123' })).rejects.toThrow('Reddit API returned HTTP 403');
    });
});
