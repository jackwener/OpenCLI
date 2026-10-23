import { describe, expect, it } from 'vitest';
import { getRegistry, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import './search.js';
import './post.js';
import './user.js';

function collected({ pk, code, author, kind, isReply = false, takenAt = 100, mediaId = '', parent = '' }) {
    return {
        pk, code, author, text: `${author} text`, likes: 1, replies: 0, reposts: 0, quotes: 0,
        is_reply: isReply, reply_to: '', taken_at: takenAt, kind, media_id: mediaId, parent,
    };
}

/** Fake browser page whose collector evaluation returns a fixed payload. */
function fakePage(payload) {
    return {
        goto: async () => {},
        wait: async () => {},
        evaluate: async () => payload,
    };
}

function run(name, payload, kwargs) {
    return getRegistry().get(`threads/${name}`).func(fakePage(payload), kwargs);
}

// Posts the collector may have seen that are not the requested evidence.
const OTHER_KIND = [
    collected({ pk: '1', code: 'REL1', author: 'spam', kind: 'reply', parent: 'OTHER' }),
    collected({ pk: '2', code: 'REL2', author: 'zuck', kind: 'search' }),
];
const OTHER_AUTHORS = [
    collected({ pk: '3', code: 'A1', author: 'alice', kind: 'profile' }),
    collected({ pk: '4', code: 'B1', author: 'bob', kind: 'profile' }),
];

describe('threads command registry', () => {
    it('registers a read-only cookie surface', () => {
        for (const name of ['search', 'post', 'user']) {
            expect(getRegistry().get(`threads/${name}`)).toMatchObject({
                access: 'read',
                strategy: Strategy.COOKIE,
                domain: 'www.threads.com',
            });
        }
    });

    it('uses positional args for the primary subject', () => {
        const positional = (name) => getRegistry().get(`threads/${name}`).args.find((a) => a.positional)?.name;
        expect(positional('search')).toBe('query');
        expect(positional('post')).toBe('target');
        expect(positional('user')).toBe('username');
    });
});

describe('threads empty evidence stays a typed failure', () => {
    it('search without search results fails instead of returning []', async () => {
        await expect(run('search', { posts: [OTHER_AUTHORS[0]], loginLink: false }, { query: 'coffee' }))
            .rejects.toBeInstanceOf(EmptyResultError);
        await expect(run('search', { posts: [], loginLink: true }, { query: 'coffee' }))
            .rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('user with only other authors fails instead of returning []', async () => {
        await expect(run('user', { posts: OTHER_AUTHORS, loginLink: false }, { username: 'zuck' }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT', hint: 'No posts by @zuck were found in the profile feed.' });
        await expect(run('user', { posts: OTHER_AUTHORS, loginLink: true }, { username: 'zuck' }))
            .rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('user ignores posts that are not in the profile feed', async () => {
        await expect(run('user', { posts: OTHER_KIND, loginLink: false }, { username: 'zuck' }))
            .rejects.toBeInstanceOf(EmptyResultError);
    });

    it('post whose target is not the main media fails', async () => {
        const posts = [collected({ pk: '9', code: 'TARGET', author: 'alice', kind: 'reply', parent: 'M' })];
        await expect(run('post', { posts, loginLink: false }, { target: 'TARGET' }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT', hint: 'Post TARGET was not found on the rendered page.' });
        await expect(run('post', { posts, loginLink: true }, { target: 'TARGET' }))
            .rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('rate limiting and challenges are reported, not shown as empty', async () => {
        await expect(run('search', { posts: [], loginLink: false, blocked: 'rate_limit' }, { query: 'x' }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC' });
        await expect(run('user', { posts: [], loginLink: false, blocked: 'challenge' }, { username: 'x' }))
            .rejects.toMatchObject({ code: 'COMMAND_EXEC' });
    });

    it('returns the main post and only its own replies', async () => {
        const posts = [
            collected({ pk: '1', code: 'MAIN01', author: 'alice', kind: 'main', mediaId: 'M' }),
            collected({ pk: '2', code: 'R1', author: 'bob', kind: 'reply', isReply: true, parent: 'M', takenAt: 300 }),
            collected({ pk: '3', code: 'R0', author: 'carol', kind: 'reply', isReply: true, parent: 'M', takenAt: 200 }),
            collected({ pk: '4', code: 'X', author: 'dave', kind: 'reply', isReply: true, parent: 'OTHER' }),
        ];
        const rows = await run('post', { posts, loginLink: false }, { target: 'MAIN01' });
        expect(rows.map((r) => r.url.split('/').pop())).toEqual(['MAIN01', 'R1', 'R0']);
    });

    it('returns rows when matching evidence exists', async () => {
        const rows = await run('user', { posts: OTHER_AUTHORS, loginLink: true }, { username: 'alice' });
        expect(rows.map((r) => r.url)).toEqual(['https://www.threads.com/@alice/post/A1']);
    });
});
