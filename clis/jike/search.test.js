import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './search.js';

const identity = {
    ok: true,
    user_id: 'user-1',
    screen_name: 'Alice',
    username: 'alice',
};

function makePage(...evaluateResults) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockImplementation(async () => evaluateResults.shift()),
    };
}

function post(id, overrides = {}) {
    return {
        id,
        type: 'ORIGINAL_POST',
        content: `post ${id}`,
        likeCount: 2,
        commentCount: 3,
        createdAt: '2026-08-25T00:00:00.000Z',
        user: { screenName: 'Alice' },
        ...overrides,
    };
}

function apiPage(data, loadMoreKey = null, overrides = {}) {
    return {
        kind: 'response',
        status: 200,
        body: { success: true, data, loadMoreKey, ...overrides },
    };
}

function command() {
    return getRegistry().get('jike/search');
}

describe('jike search API pagination', () => {
    it('preserves the seven-column contract and maps structured posts', async () => {
        const page = makePage(identity, apiPage([
            { type: 'SECTION_HEADER', title: 'posts' },
            post('post-1', { content: 'hello\nworld', likeCount: '4', commentCount: null }),
        ], { skip: 20 }));

        await expect(command().func(page, { query: 'OpenCLI', limit: 1 })).resolves.toEqual([{
            id: 'post-1',
            author: 'Alice',
            content: 'hello world',
            likes: 4,
            comments: 0,
            time: '2026-08-25T00:00:00.000Z',
            url: 'https://web.okjike.com/originalPost/post-1',
        }]);
        expect(command().columns).toEqual(['id', 'author', 'content', 'likes', 'comments', 'time', 'url']);
        expect(page.goto).toHaveBeenCalledWith('https://web.okjike.com/search?q=OpenCLI');
        expect(page.evaluate).toHaveBeenCalledTimes(2);
    });

    it('follows loadMoreKey, filters non-post results, deduplicates, and stops at upstream exhaustion', async () => {
        const page = makePage(
            identity,
            apiPage([post('post-1'), { type: 'TOPIC', id: 'topic-1' }], { skip: 20 }),
            apiPage([post('post-1'), post('post-2')]),
        );

        const rows = await command().func(page, { query: 'open cli', limit: 50 });
        expect(rows.map((row) => row.id)).toEqual(['post-1', 'post-2']);
        expect(page.goto).toHaveBeenCalledWith('https://web.okjike.com/search?q=open%20cli');
        expect(page.evaluate).toHaveBeenCalledTimes(3);
        expect(page.evaluate.mock.calls[2][0]).toContain('"skip":20');
    });

    it('does not validate an unused cursor after satisfying --limit', async () => {
        const page = makePage(identity, apiPage([post('post-1')], 'future-cursor-shape'));
        await expect(command().func(page, { query: 'OpenCLI', limit: 1 })).resolves.toHaveLength(1);
    });

    it('returns EmptyResult only for a valid exhausted response with no posts', async () => {
        const page = makePage(identity, apiPage([{ type: 'SECTION_HEADER' }]));
        await expect(command().func(page, { query: 'no-results', limit: 20 }))
            .rejects.toBeInstanceOf(EmptyResultError);
    });

    it.each([
        [{ kind: 'auth', detail: 'expired' }, AuthRequiredError],
        [{ kind: 'response', status: 403, body: {} }, AuthRequiredError],
        [{ kind: 'transport', detail: 'offline' }, CommandExecutionError],
        [{ kind: 'json', status: 200, detail: 'bad json' }, CommandExecutionError],
        [{ kind: 'response', status: 500, body: {} }, CommandExecutionError],
        [{ unexpected: true }, CommandExecutionError],
        [{ kind: 'response', status: 200, body: { success: false, message: 'denied' } }, CommandExecutionError],
        [{ kind: 'response', status: 200, body: { success: true, data: null } }, CommandExecutionError],
    ])('maps API failure %# to a typed error', async (outcome, ErrorType) => {
        const page = makePage(identity, outcome);
        await expect(command().func(page, { query: 'OpenCLI', limit: 20 })).rejects.toBeInstanceOf(ErrorType);
    });

    it('rejects malformed posts and cursors instead of returning partial rows', async () => {
        await expect(command().func(makePage(identity, apiPage([
            post('post-1'),
            { type: 'ORIGINAL_POST', content: 'missing id' },
        ])), { query: 'OpenCLI', limit: 20 })).rejects.toBeInstanceOf(CommandExecutionError);

        await expect(command().func(makePage(identity, apiPage([], 'bad-cursor')), {
            query: 'OpenCLI', limit: 20,
        })).rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('malformed pagination cursor') });
    });

    it('rejects repeated cursors and page-budget exhaustion without returning accumulated rows', async () => {
        const cursor = { skip: 20 };
        await expect(command().func(makePage(
            identity,
            apiPage([post('post-1')], cursor),
            apiPage([], cursor),
        ), { query: 'OpenCLI', limit: 20 })).rejects.toMatchObject({
            code: 'COMMAND_EXEC',
            message: expect.stringContaining('repeated cursor'),
        });

        const pages = Array.from({ length: 50 }, (_, index) => apiPage([], { skip: index + 1 }));
        await expect(command().func(makePage(identity, ...pages), { query: 'OpenCLI', limit: 20 }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC', message: expect.stringContaining('exceeded 50 pages') });
    });

    it.each([
        [{ query: '', limit: 20 }, ArgumentError],
        [{ query: 'OpenCLI', limit: 0 }, ArgumentError],
        [{ query: 'OpenCLI', limit: 1.5 }, ArgumentError],
        [{ query: 'OpenCLI', limit: '20' }, ArgumentError],
    ])('validates arguments before browser work: %#', async (args, ErrorType) => {
        const page = makePage();
        await expect(command().func(page, args)).rejects.toBeInstanceOf(ErrorType);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });
});
