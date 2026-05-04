import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './subscribed.js';
describe('reddit subscribed adapter', () => {
    const command = getRegistry().get('reddit/subscribed');
    it('returns subscribed subreddits from the browser-evaluated payload', async () => {
        const fixture = [
            { subreddit: 'r/programming', title: 'Programming', subscribers: 6000000, description: 'All things code', url: 'https://www.reddit.com/r/programming/' },
            { subreddit: 'r/MachineLearning', title: 'Machine Learning', subscribers: 3000000, description: 'ML research', url: 'https://www.reddit.com/r/MachineLearning/' },
        ];
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue(fixture),
        };
        const result = await command.func(page, { limit: 100 });
        expect(page.goto).toHaveBeenCalledWith('https://www.reddit.com');
        expect(result).toEqual(fixture);
    });
    it('throws AuthRequiredError when not logged in', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ error: 'Not logged in — cannot list subscriptions' }),
        };
        await expect(command.func(page, { limit: 100 })).rejects.toThrow('Not logged in');
    });
    it('surfaces HTTP errors clearly', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({ error: 'HTTP 429 from /subreddits/mine/subscriptions.json?limit=100' }),
        };
        await expect(command.func(page, { limit: 100 })).rejects.toThrow('HTTP 429');
    });
    it('respects --limit by slicing the final result', async () => {
        const fixture = Array.from({ length: 5 }, (_, i) => ({
            subreddit: 'r/sub' + i,
            title: 'Sub ' + i,
            subscribers: 1000,
            description: '',
            url: 'https://www.reddit.com/r/sub' + i + '/',
        }));
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue(fixture),
        };
        const result = await command.func(page, { limit: 3 });
        expect(result).toHaveLength(3);
        expect(result[0].subreddit).toBe('r/sub0');
    });
});
