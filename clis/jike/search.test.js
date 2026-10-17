import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
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

});
