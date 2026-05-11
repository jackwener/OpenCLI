import { describe, expect, it, vi } from 'vitest';
import { extractJsonAssignmentFromHtml, extractSubscriptionChannel, prepareYoutubeApiPage, readYoutubeSapisid } from './utils.js';
describe('youtube utils', () => {
    it('extractJsonAssignmentFromHtml parses bootstrap objects with nested braces in strings', () => {
        const html = `
      <script>
        var ytInitialPlayerResponse = {
          "title": "brace { inside } string",
          "nested": { "count": 2, "text": "quote \\"value\\"" }
        };
      </script>
    `;
        expect(extractJsonAssignmentFromHtml(html, 'ytInitialPlayerResponse')).toEqual({
            title: 'brace { inside } string',
            nested: { count: 2, text: 'quote "value"' },
        });
    });
    it('extractJsonAssignmentFromHtml supports window assignments', () => {
        const html = `
      <script>
        window["ytInitialData"] = {"contents":{"items":[1,2,3]}};
      </script>
    `;
        expect(extractJsonAssignmentFromHtml(html, 'ytInitialData')).toEqual({
            contents: { items: [1, 2, 3] },
        });
    });
    it('prepareYoutubeApiPage loads the quiet API bootstrap page', async () => {
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
        };
        await expect(prepareYoutubeApiPage(page)).resolves.toBeUndefined();
        expect(page.goto).toHaveBeenCalledWith('https://www.youtube.com', { waitUntil: 'none' });
        expect(page.wait).toHaveBeenCalledWith(2);
    });
    it('readYoutubeSapisid reads URL-scoped cookies and prefers secure SAPISID', async () => {
        const page = {
            getCookies: vi.fn().mockResolvedValue([
                { name: 'SAPISID', value: 'legacy' },
                { name: '__Secure-3PAPISID', value: 'secure' },
            ]),
        };
        await expect(readYoutubeSapisid(page)).resolves.toBe('secure');
        expect(page.getCookies).toHaveBeenCalledWith({ url: 'https://www.youtube.com' });
    });
    it('readYoutubeSapisid falls back to legacy SAPISID', async () => {
        const page = {
            getCookies: vi.fn().mockResolvedValue([{ name: 'SAPISID', value: 'legacy' }]),
        };
        await expect(readYoutubeSapisid(page)).resolves.toBe('legacy');
    });
    it('extractSubscriptionChannel prefers explicit handle and subscriber count fields', () => {
        expect(extractSubscriptionChannel({
            title: { simpleText: 'OpenAI' },
            channelHandleText: { runs: [{ text: '@openai' }] },
            subscriberCountText: { simpleText: '1.23M subscribers' },
            videoCountText: { simpleText: '123 videos' },
            navigationEndpoint: { browseEndpoint: { canonicalBaseUrl: '/channel/UC123' } },
            channelId: 'UC123',
        })).toEqual({
            name: 'OpenAI',
            handle: '@openai',
            subscribers: '1.23M subscribers',
            url: 'https://www.youtube.com/channel/UC123',
        });
    });
    it('extractSubscriptionChannel falls back when handle/count fields are overloaded', () => {
        expect(extractSubscriptionChannel({
            title: {
                runs: [{ text: 'OpenAI' }],
            },
            subscriberCountText: { simpleText: '@openai' },
            videoCountText: { simpleText: '1.23M subscribers' },
            navigationEndpoint: { browseEndpoint: { canonicalBaseUrl: '/@openai' } },
            channelId: 'UC123',
        })).toEqual({
            name: 'OpenAI',
            handle: '@openai',
            subscribers: '1.23M subscribers',
            url: 'https://www.youtube.com/@openai',
        });
    });
});
