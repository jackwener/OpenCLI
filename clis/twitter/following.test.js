import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { __test__ } from './following.js';

describe('twitter following helpers', () => {
    it('falls back when queryId contains unsafe characters', () => {
        expect(__test__.sanitizeQueryId('safe_Query-123', 'fallback')).toBe('safe_Query-123');
        expect(__test__.sanitizeQueryId('bad"id', 'fallback')).toBe('fallback');
        expect(__test__.sanitizeQueryId('bad/id', 'fallback')).toBe('fallback');
        expect(__test__.sanitizeQueryId(null, 'fallback')).toBe('fallback');
    });

    it('builds following url with cursor', () => {
        const url = __test__.buildFollowingUrl('query123', '42', 20, 'cursor-1');
        expect(url).toContain('/i/api/graphql/query123/Following');
        expect(decodeURIComponent(url)).toContain('"userId":"42"');
        expect(decodeURIComponent(url)).toContain('"count":20');
        expect(decodeURIComponent(url)).toContain('"cursor":"cursor-1"');
    });

    it('builds following url without cursor', () => {
        const url = __test__.buildFollowingUrl('query123', '42', 20);
        expect(url).toContain('/i/api/graphql/query123/Following');
        expect(decodeURIComponent(url)).not.toContain('"cursor"');
    });

    it('extracts user from result', () => {
        const user = __test__.extractUser({
            __typename: 'User',
            core: { screen_name: 'alice', name: 'Alice' },
            legacy: { description: 'bio text', followers_count: 100 },
        });
        expect(user).toMatchObject({
            screen_name: 'alice',
            name: 'Alice',
            bio: 'bio text',
            followers: 100,
        });
    });

    it('returns null for non-User typename', () => {
        expect(__test__.extractUser({ __typename: 'Tweet' })).toBeNull();
        expect(__test__.extractUser(null)).toBeNull();
        expect(__test__.extractUser(undefined)).toBeNull();
    });

    it('falls back to legacy screen_name if core is missing', () => {
        const user = __test__.extractUser({
            __typename: 'User',
            legacy: { screen_name: 'bob', name: 'Bob', description: '', followers_count: 0 },
        });
        expect(user?.screen_name).toBe('bob');
    });

    it('parses following timeline with users and cursor', () => {
        const payload = {
            data: {
                user: {
                    result: {
                        timeline_v2: {
                            timeline: {
                                instructions: [{
                                    entries: [
                                        {
                                            entryId: 'user-1',
                                            content: {
                                                itemContent: {
                                                    user_results: {
                                                        result: {
                                                            __typename: 'User',
                                                            core: { screen_name: 'bob', name: 'Bob' },
                                                            legacy: { description: 'hello', followers_count: 50 },
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                        {
                                            entryId: 'user-2',
                                            content: {
                                                itemContent: {
                                                    user_results: {
                                                        result: {
                                                            __typename: 'User',
                                                            core: { screen_name: 'carol', name: 'Carol' },
                                                            legacy: { description: 'world', followers_count: 200 },
                                                        },
                                                    },
                                                },
                                            },
                                        },
                                        {
                                            entryId: 'cursor-bottom-1',
                                            content: {
                                                entryType: 'TimelineTimelineCursor',
                                                cursorType: 'Bottom',
                                                value: 'next-cursor',
                                            },
                                        },
                                    ],
                                }],
                            },
                        },
                    },
                },
            },
        };
        const result = __test__.parseFollowing(payload);
        expect(result.users).toHaveLength(2);
        expect(result.users[0]).toMatchObject({ screen_name: 'bob', name: 'Bob', followers: 50 });
        expect(result.users[1]).toMatchObject({ screen_name: 'carol', name: 'Carol', followers: 200 });
        expect(result.nextCursor).toBe('next-cursor');
    });

    it('handles cursor-bottom entryId pattern', () => {
        const payload = {
            data: {
                user: {
                    result: {
                        timeline: {
                            timeline: {
                                instructions: [{
                                    entries: [
                                        {
                                            entryId: 'cursor-bottom-0',
                                            content: {
                                                itemContent: { value: 'cursor-val' },
                                            },
                                        },
                                    ],
                                }],
                            },
                        },
                    },
                },
            },
        };
        const result = __test__.parseFollowing(payload);
        expect(result.nextCursor).toBe('cursor-val');
        expect(result.users).toHaveLength(0);
    });

    it('returns empty users and null cursor for missing instructions', () => {
        const result = __test__.parseFollowing({ data: { user: { result: {} } } });
        expect(result.users).toHaveLength(0);
        expect(result.nextCursor).toBeNull();
    });

    it('returns empty for completely empty payload', () => {
        const result = __test__.parseFollowing({});
        expect(result.users).toHaveLength(0);
        expect(result.nextCursor).toBeNull();
    });

    it('normalizes screen names for CLI and profile-link inputs', () => {
        expect(__test__.normalizeScreenName('@elonmusk')).toBe('elonmusk');
        expect(__test__.normalizeScreenName('/elonmusk')).toBe('elonmusk');
        expect(__test__.normalizeScreenName('  @@alice  ')).toBe('alice');
    });
});

function followingPayload(users, cursor) {
    return {
        data: {
            user: {
                result: {
                    timeline_v2: {
                        timeline: {
                            instructions: [{
                                entries: [
                                    ...users.map((name) => ({
                                        entryId: `user-${name}`,
                                        content: {
                                            itemContent: {
                                                user_results: {
                                                    result: {
                                                        __typename: 'User',
                                                        core: { screen_name: name, name: name.toUpperCase() },
                                                        legacy: { description: `${name} bio`, followers_count: 10 },
                                                    },
                                                },
                                            },
                                        },
                                    })),
                                    ...(cursor ? [{
                                        entryId: `cursor-bottom-${cursor}`,
                                        content: {
                                            entryType: 'TimelineTimelineCursor',
                                            cursorType: 'Bottom',
                                            value: cursor,
                                        },
                                    }] : []),
                                ],
                            }],
                        },
                    },
                },
            },
        },
    };
}

function createFollowingPage(followingResponses, { ct0 = 'token', userLookup = { userId: '42' } } = {}) {
    const page = {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn(async (script) => {
            if (script.includes('document.cookie')) return ct0;
            if (script.includes('operationName')) return null;
            if (script.includes('/UserByScreenName')) return userLookup;
            if (script.includes('/Following')) return followingResponses.shift() || followingPayload([], null);
            if (script.includes('AppTabBar_Profile_Link')) return '/viewer';
            throw new Error(`Unexpected evaluate script: ${script.slice(0, 80)}`);
        }),
    };
    return page;
}

describe('twitter following command', () => {
    it('paginates with cursor, deduplicates users, strips @, and respects limit', async () => {
        const command = getRegistry().get('twitter/following');
        const page = createFollowingPage([
            followingPayload(['alice', 'bob'], 'cursor-1'),
            followingPayload(['bob', 'carol', 'dave'], null),
        ]);

        const rows = await command.func(page, { user: '@elonmusk', limit: 3 });

        expect(rows.map((row) => row.screen_name)).toEqual(['alice', 'bob', 'carol']);
        const userLookupScript = page.evaluate.mock.calls.find(([script]) => script.includes('/UserByScreenName'))?.[0] || '';
        expect(decodeURIComponent(userLookupScript)).toContain('"screen_name":"elonmusk"');
        expect(decodeURIComponent(userLookupScript)).not.toContain('"screen_name":"@elonmusk"');
        const followingCalls = page.evaluate.mock.calls.filter(([script]) => script.includes('/Following'));
        expect(followingCalls).toHaveLength(2);
        expect(decodeURIComponent(followingCalls[1][0])).toContain('"cursor":"cursor-1"');
    });

    it('rejects invalid limits before navigating', async () => {
        const command = getRegistry().get('twitter/following');
        const page = createFollowingPage([]);

        await expect(command.func(page, { user: 'elonmusk', limit: 0 })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
    });

    it('maps first-page auth failures to AuthRequiredError', async () => {
        const command = getRegistry().get('twitter/following');
        const page = createFollowingPage([{ error: 401 }]);

        await expect(command.func(page, { user: 'elonmusk', limit: 10 })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('does not silently return partial rows when a later page fails', async () => {
        const command = getRegistry().get('twitter/following');
        const page = createFollowingPage([
            followingPayload(['alice'], 'cursor-1'),
            { error: 429 },
        ]);

        await expect(command.func(page, { user: 'elonmusk', limit: 10 })).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('maps user lookup auth failures to AuthRequiredError', async () => {
        const command = getRegistry().get('twitter/following');
        const page = createFollowingPage([], { userLookup: { error: 403 } });

        await expect(command.func(page, { user: 'elonmusk', limit: 10 })).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('fails fast when the following timeline is empty', async () => {
        const command = getRegistry().get('twitter/following');
        const page = createFollowingPage([followingPayload([], null)]);

        await expect(command.func(page, { user: 'elonmusk', limit: 10 })).rejects.toBeInstanceOf(EmptyResultError);
    });
});
