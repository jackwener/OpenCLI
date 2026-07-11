import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import './article.js';

function createPage(articleResult) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        getCookies: vi.fn().mockResolvedValue([{ name: 'ct0', value: 'csrf-token' }]),
        evaluate: vi.fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(articleResult),
    };
}

describe('twitter article command', () => {
    it('unwraps Browser Bridge envelopes around article rows', async () => {
        const command = getRegistry().get('twitter/article');
        const rows = [{
            title: 'Long article',
            author: 'alice',
            content: 'body',
            url: 'https://x.com/alice/status/1234567890',
        }];

        await expect(command.func(createPage({ session: 'browser:default', data: rows }), { 'tweet-id': '1234567890' }))
            .resolves.toEqual(rows);
    });

    it('maps HTTP auth failures to AuthRequiredError', async () => {
        const command = getRegistry().get('twitter/article');

        await expect(command.func(createPage({ httpStatus: 401 }), { 'tweet-id': '1234567890' }))
            .rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('fails closed for malformed article response envelopes', async () => {
        const command = getRegistry().get('twitter/article');

        await expect(command.func(createPage({}), { 'tweet-id': '1234567890' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func(createPage({ session: 'browser:default', data: {} }), { 'tweet-id': '1234567890' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(command.func(createPage(null), { 'tweet-id': '1234567890' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('surfaces GraphQL error payloads instead of returning a success-shaped fallback', async () => {
        const command = getRegistry().get('twitter/article');

        await expect(command.func(createPage({
            error: 'Twitter TweetResultByRestId returned GraphQL errors: [{"message":"rate limited"}]',
        }), { 'tweet-id': '1234567890' })).rejects.toThrow(/GraphQL errors/);
    });
});
