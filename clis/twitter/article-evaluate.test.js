import { describe, expect, it } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { createPageMock } from '../test-utils.js';
import './article.js';

describe('twitter article command', () => {
    it('embeds tweet-id in page.evaluate through JSON.stringify', async () => {
        const command = getRegistry().get('twitter/article');
        const tweetId = '123"; window.__opencliInjected = true; //';
        const page = createPageMock([
            null,
            [{
                title: '(Note Tweet)',
                author: 'alice',
                content: 'hello',
                url: 'https://x.com/alice/status/123',
            }],
        ], {
            getCookies: async () => [{ name: 'ct0', value: 'csrf-token' }],
        });

        const result = await command.func(page, { 'tweet-id': tweetId });

        expect(result).toEqual([{
            title: '(Note Tweet)',
            author: 'alice',
            content: 'hello',
            url: 'https://x.com/alice/status/123',
        }]);
        expect(page.goto).toHaveBeenCalledWith(`https://x.com/i/status/${tweetId}`);
        const graphqlScript = page.evaluate.mock.calls[1][0];
        expect(graphqlScript).toContain(`const tweetId = ${JSON.stringify(tweetId)};`);
        expect(graphqlScript).not.toContain('const tweetId = "123"; window.__opencliInjected = true; //";');
    });
});
