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

function createPageWithEvaluateResults(evaluateResults) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        getCookies: vi.fn().mockResolvedValue([{ name: 'ct0', value: 'csrf-token' }]),
        evaluate: vi.fn()
            .mockImplementation(() => Promise.resolve(evaluateResults.shift())),
    };
}

function validArticlePayload(overrides = {}) {
    return {
        data: {
            tweetResult: {
                result: {
                    tweet: {
                        rest_id: '1234567890',
                        legacy: { full_text: 'fallback text' },
                        core: {
                            user_results: {
                                result: {
                                    legacy: { screen_name: 'alice' },
                                },
                            },
                        },
                        article: {
                            article_results: {
                                result: {
                                    title: 'Long article',
                                    content_state: {
                                        blocks: [{ type: 'unstyled', text: 'body' }],
                                    },
                                },
                            },
                        },
                        ...overrides.tweet,
                    },
                },
            },
        },
    };
}

async function evaluateArticleFetchScript(script, payload) {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(payload),
    });
    try {
        // The adapter passes Browser Bridge an `async () => { ... }` source string.
        return await eval(`(${script})`)();
    } finally {
        globalThis.fetch = previousFetch;
    }
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

    it('unwraps Browser Bridge envelopes when resolving /i/article URLs to parent tweet ids', async () => {
        const command = getRegistry().get('twitter/article');
        const rows = [{
            title: 'Long article',
            author: 'alice',
            content: 'body',
            url: 'https://x.com/alice/status/1234567890',
        }];
        const page = createPageWithEvaluateResults([
            { session: 'browser:default', data: '1234567890' },
            null,
            rows,
        ]);

        await expect(command.func(page, { 'tweet-id': 'https://x.com/i/article/987654321' }))
            .resolves.toEqual(rows);
        expect(page.goto).toHaveBeenNthCalledWith(1, 'https://x.com/i/article/987654321');
        expect(page.goto).toHaveBeenNthCalledWith(2, 'https://x.com/i/status/1234567890');
    });

    it('fails closed when article API nested result shapes are malformed', async () => {
        const command = getRegistry().get('twitter/article');
        const page = createPageWithEvaluateResults([
            null,
            undefined,
        ]);
        page.evaluate.mockImplementationOnce(() => Promise.resolve(null));
        page.evaluate.mockImplementationOnce(async (script) => evaluateArticleFetchScript(script, validArticlePayload({
            tweet: {
                article: { article_results: { result: 'not-an-object' } },
            },
        })));

        await expect(command.func(page, { 'tweet-id': '1234567890' }))
            .rejects.toThrow(/article result was malformed/);
    });

    it('fails closed when article API content blocks are malformed', async () => {
        const command = getRegistry().get('twitter/article');
        const page = createPageWithEvaluateResults([
            null,
            undefined,
        ]);
        page.evaluate.mockImplementationOnce(() => Promise.resolve(null));
        page.evaluate.mockImplementationOnce(async (script) => evaluateArticleFetchScript(script, validArticlePayload({
            tweet: {
                article: { article_results: { result: { title: 'Bad', content_state: { blocks: {} } } } },
            },
        })));

        await expect(command.func(page, { 'tweet-id': '1234567890' }))
            .rejects.toThrow(/article blocks were malformed/);
    });
});
