import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './search.js';

describe('youtube search', () => {
    it('uses Browser Bridge envelope-wrapped search results', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue({
                session: 'browser:default',
                data: [{
                    rank: 1,
                    title: 'First Time in China',
                    channel: 'Travel Channel',
                    views: '1M views',
                    duration: '20:00',
                    published: '1 day ago',
                    url: 'https://www.youtube.com/watch?v=abc123def45',
                }],
            }),
        };
        const command = getRegistry().get('youtube/search');

        const rows = await command.func(page, { query: 'first time in China', limit: 3, type: 'video' });

        expect(rows).toEqual([expect.objectContaining({
            title: 'First Time in China',
            url: 'https://www.youtube.com/watch?v=abc123def45',
        })]);
    });
});
