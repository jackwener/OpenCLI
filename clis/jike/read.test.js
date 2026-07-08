import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import './post.js';
import './topic.js';
import './user.js';

function makePage(evaluateResult) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn().mockResolvedValue(evaluateResult),
    };
}

describe('jike read commands', () => {
    it('maps post rows from the browser-side extractor', async () => {
        const command = getRegistry().get('jike/post');
        const page = makePage([
            { type: 'post', author: 'alice', content: 'hello', likes: 3, time: '2026-05-16' },
            { type: 'comment', author: 'bob', content: 'nice', likes: 1, time: '2026-05-16' },
        ]);

        await expect(command.func(page, { id: 'post-1' })).resolves.toEqual([
            { type: 'post', author: 'alice', content: 'hello', likes: 3, time: '2026-05-16' },
            { type: 'comment', author: 'bob', content: 'nice', likes: 1, time: '2026-05-16' },
        ]);
        expect(page.goto).toHaveBeenCalledWith('https://m.okjike.com/originalPosts/post-1');
    });

    it('maps topic rows and applies limit on the Node side', async () => {
        const command = getRegistry().get('jike/topic');
        const page = makePage([
            { id: 'a', content: 'one', author: 'alice', likes: 1, comments: 2, time: 't1' },
            { id: 'b', content: 'two', author: 'bob', likes: 3, comments: 4, time: 't2' },
        ]);

        await expect(command.func(page, { id: 'topic-1', limit: 1 })).resolves.toEqual([
            {
                content: 'one',
                author: 'alice',
                likes: 1,
                comments: 2,
                time: 't1',
                url: 'https://web.okjike.com/originalPost/a',
            },
        ]);
        expect(page.goto).toHaveBeenCalledWith('https://m.okjike.com/topics/topic-1');
    });

    it('maps user rows and applies limit on the Node side', async () => {
        const command = getRegistry().get('jike/user');
        const page = makePage([
            { id: 'a', content: 'one', type: 'post', likes: 1, comments: 2, time: 't1' },
            { id: 'b', content: 'two', type: 'repost', likes: 3, comments: 4, time: 't2' },
        ]);

        await expect(command.func(page, { username: 'alice', limit: 1 })).resolves.toEqual([
            {
                id: 'a',
                content: 'one',
                type: 'post',
                likes: 1,
                comments: 2,
                time: 't1',
                url: 'https://web.okjike.com/originalPost/a',
            },
        ]);
        expect(page.goto).toHaveBeenCalledWith('https://m.okjike.com/users/alice');
    });

    it('throws CommandExecutionError for malformed browser-side payloads', async () => {
        await expect(getRegistry().get('jike/post').func(makePage({ reason: 'missing-data-script' }), { id: 'post-1' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(getRegistry().get('jike/topic').func(makePage({ reason: 'parse-error', message: 'bad json' }), { id: 'topic-1' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
        await expect(getRegistry().get('jike/user').func(makePage(null), { username: 'alice' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('throws EmptyResultError when topic or user extractors return no posts', async () => {
        await expect(getRegistry().get('jike/topic').func(makePage([]), { id: 'topic-1' }))
            .rejects.toBeInstanceOf(EmptyResultError);
        await expect(getRegistry().get('jike/user').func(makePage([]), { username: 'alice' }))
            .rejects.toBeInstanceOf(EmptyResultError);
    });
});
