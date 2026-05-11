import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import './read.js';
describe('reddit read adapter', () => {
    const command = getRegistry().get('reddit/read');
    it('opts into the Reddit persistent site session', () => {
        expect(command?.browser).toBe(true);
        expect(command?.siteSession).toBe('persistent');
    });
    it('exposes the threaded shape including the 4 media columns', () => {
        expect(command?.columns).toEqual([
            'type', 'author', 'score', 'text',
            'post_hint', 'url_overridden_by_dest', 'preview_image_url', 'gallery_urls',
        ]);
    });
    it('embeds extractRedditMedia in the browser-evaluated source and applies it to the POST row', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue([]),
        };
        await command.func(page, { 'post-id': 'abc123', limit: 5 });
        const src = page.evaluate.mock.calls[0][0];
        expect(src).toContain('function extractRedditMedia');
        expect(src).toContain('var postMedia = extractRedditMedia(post)');
    });
    it('returns threaded rows from the browser-evaluated payload', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn().mockResolvedValue([
                { type: 'POST', author: 'alice', score: 10, text: 'Title',
                  post_hint: 'image', url_overridden_by_dest: 'https://i.redd.it/a.jpg',
                  preview_image_url: 'https://preview.redd.it/a.jpg?width=640',
                  gallery_urls: [] },
                { type: 'L0', author: 'bob', score: 5, text: 'Comment',
                  post_hint: '', url_overridden_by_dest: '', preview_image_url: '', gallery_urls: [] },
            ]),
        };
        const result = await command.func(page, { 'post-id': 'abc123', limit: 5 });
        expect(page.goto).toHaveBeenCalledWith('https://www.reddit.com');
        expect(result).toEqual([
            { type: 'POST', author: 'alice', score: 10, text: 'Title',
              post_hint: 'image', url_overridden_by_dest: 'https://i.redd.it/a.jpg',
              preview_image_url: 'https://preview.redd.it/a.jpg?width=640',
              gallery_urls: [] },
            { type: 'L0', author: 'bob', score: 5, text: 'Comment',
              post_hint: '', url_overridden_by_dest: '', preview_image_url: '', gallery_urls: [] },
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
