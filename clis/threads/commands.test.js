import { describe, expect, it } from 'vitest';
import { getRegistry, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
import './search.js';
import './post.js';
import './user.js';

function collected({ pk, code, author, related = false, isReply = false, takenAt = 100 }) {
    return {
        pk, code, author, text: `${author} text`, likes: 1, replies: 0, reposts: 0, quotes: 0,
        is_reply: isReply, reply_to: '', taken_at: takenAt, related,
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

const ONLY_RELATED = [
    collected({ pk: '1', code: 'REL1', author: 'spam', related: true }),
    collected({ pk: '2', code: 'REL2', author: 'zuck', related: true }),
];
const ONLY_OTHER_AUTHORS = [
    collected({ pk: '3', code: 'A1', author: 'alice' }),
    collected({ pk: '4', code: 'B1', author: 'bob' }),
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
    it('search with only related posts fails instead of returning []', async () => {
        await expect(run('search', { posts: ONLY_RELATED, loginLink: false }, { query: 'coffee' }))
            .rejects.toBeInstanceOf(EmptyResultError);
        await expect(run('search', { posts: ONLY_RELATED, loginLink: true }, { query: 'coffee' }))
            .rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('user with only other authors fails instead of returning []', async () => {
        await expect(run('user', { posts: ONLY_OTHER_AUTHORS, loginLink: false }, { username: 'zuck' }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT', hint: 'No posts by @zuck were rendered.' });
        await expect(run('user', { posts: ONLY_OTHER_AUTHORS, loginLink: true }, { username: 'zuck' }))
            .rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('user with only related posts by the requested author fails', async () => {
        await expect(run('user', { posts: ONLY_RELATED, loginLink: false }, { username: 'zuck' }))
            .rejects.toBeInstanceOf(EmptyResultError);
    });

    it('post whose target only appears as a related post fails', async () => {
        const posts = [collected({ pk: '9', code: 'TARGET', author: 'alice', related: true })];
        await expect(run('post', { posts, loginLink: false }, { target: 'TARGET' }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT', hint: 'Post TARGET was not found on the rendered page.' });
        await expect(run('post', { posts, loginLink: true }, { target: 'TARGET' }))
            .rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('returns rows when matching evidence exists', async () => {
        const rows = await run('user', { posts: ONLY_OTHER_AUTHORS, loginLink: true }, { username: 'alice' });
        expect(rows.map((r) => r.url)).toEqual(['https://www.threads.com/@alice/post/A1']);
    });
});
