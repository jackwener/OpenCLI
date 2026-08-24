import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError, TimeoutError } from '@jackwener/opencli/errors';
import { __test__ } from './followers.js';

function followerResult(screenName, overrides = {}) {
    return {
        __typename: 'User',
        core: { screen_name: screenName, name: screenName.toUpperCase() },
        profile_bio: { description: `${screenName} bio` },
        relationship_counts: { followers: 10, following: 5 },
        ...overrides,
    };
}

function followersPayload(users, cursor, { terminateBottom = false } = {}) {
    return {
        data: {
            user: {
                result: {
                    __typename: 'User',
                    timeline: {
                        timeline: {
                            instructions: [
                                ...(terminateBottom ? [{ type: 'TimelineTerminateTimeline', direction: 'Bottom' }] : []),
                                {
                                    entries: [
                                        ...users.map((name) => ({
                                            entryId: `user-${name}`,
                                            content: {
                                                itemContent: {
                                                    user_results: { result: followerResult(name) },
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
                                },
                            ],
                        },
                    },
                },
            },
        },
    };
}

function createFollowersPage(captureBatches, {
    ct0 = 'token',
    profileHref = '/viewer',
    currentPath = '/elonmusk/followers',
} = {}) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        getCookies: vi.fn(async () => (ct0 ? [{ name: 'ct0', value: ct0 }] : [])),
        installInterceptor: vi.fn().mockResolvedValue(undefined),
        waitForCapture: vi.fn().mockResolvedValue(undefined),
        autoScroll: vi.fn().mockResolvedValue(undefined),
        getInterceptedRequests: vi.fn(async () => captureBatches.shift() || []),
        evaluate: vi.fn(async (script) => {
            const text = String(script);
            if (text.includes('AppTabBar_Profile_Link')) return profileHref;
            if (text.includes('window.location.pathname')) return currentPath;
            if (text.includes('history.pushState')) return undefined;
            throw new Error(`Unexpected evaluate: ${text.slice(0, 100)}`);
        }),
    };
}

describe('twitter followers helpers', () => {
    it('normalizes exact profile handles and rejects route-like hrefs', () => {
        expect(__test__.normalizeScreenName('@viewer')).toBe('viewer');
        expect(__test__.normalizeScreenName('/viewer')).toBe('viewer');
        expect(__test__.normalizeScreenName('https://x.com/viewer')).toBe('viewer');
        expect(__test__.normalizeScreenName('/home')).toBe('');
        expect(__test__.normalizeScreenName('/viewer/extra')).toBe('');
    });

    it('extracts modern GraphQL user fields and preserves the three-column contract', () => {
        expect(__test__.extractFollower(followerResult('alice'))).toEqual({
            screen_name: 'alice',
            name: 'ALICE',
            bio: 'alice bio',
        });
    });

    it('falls back to legacy user fields', () => {
        expect(__test__.extractFollower({
            __typename: 'User',
            legacy: { screen_name: 'legacy', name: 'Legacy', description: 'old bio' },
        })).toEqual({ screen_name: 'legacy', name: 'Legacy', bio: 'old bio' });
    });

    it('typed-fails when a GraphQL user loses its identity field', () => {
        expect(() => __test__.extractFollower({ __typename: 'User', core: { name: 'Missing' } }))
            .toThrow(CommandExecutionError);
    });

    it('parses timeline users and the bottom cursor', () => {
        const parsed = __test__.parseFollowers(followersPayload(['alice', 'bob'], 'cursor-1'));
        expect(parsed.users.map((user) => user.screen_name)).toEqual(['alice', 'bob']);
        expect(parsed.nextCursor).toBe('cursor-1');
    });

    it('treats a bottom termination instruction as authoritative over a decorative cursor', () => {
        const parsed = __test__.parseFollowers(followersPayload(['alice'], 'decorative-cursor', { terminateBottom: true }));
        expect(parsed.users.map((user) => user.screen_name)).toEqual(['alice']);
        expect(parsed.bottomTerminated).toBe(true);
        expect(parsed.nextCursor).toBeNull();
    });

    it('unwraps Browser Bridge envelopes before parsing', () => {
        const parsed = __test__.parseFollowers({ session: 'site:twitter', data: followersPayload(['alice'], null) });
        expect(parsed.users.map((user) => user.screen_name)).toEqual(['alice']);
    });

    it('formats GraphQL error payloads without treating them as empty success', () => {
        expect(__test__.twitterGraphqlError({ errors: [{ code: 88, message: 'Rate limit exceeded' }] }))
            .toBe('Twitter Followers GraphQL error 88: Rate limit exceeded');
        expect(__test__.twitterGraphqlError({ data: {} })).toBeNull();
    });
});

describe('twitter followers command', () => {
    it('rejects invalid explicit users before navigation', async () => {
        const command = getRegistry().get('twitter/followers');
        const page = createFollowersPage([]);

        await expect(command.func(page, { user: 'viewer/extra', limit: 10 })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.getCookies).not.toHaveBeenCalled();
    });

    it('requires an authenticated x.com session before interception', async () => {
        const command = getRegistry().get('twitter/followers');
        const page = createFollowersPage([], { ct0: null });

        await expect(command.func(page, { user: 'elonmusk', limit: 10 })).rejects.toBeInstanceOf(AuthRequiredError);
        expect(page.installInterceptor).not.toHaveBeenCalled();
    });

    it('rejects non-profile AppTabBar hrefs instead of navigating to a route-like handle', async () => {
        const command = getRegistry().get('twitter/followers');
        const page = createFollowersPage([], { profileHref: '/home' });

        await expect(command.func(page, { limit: 10 })).rejects.toBeInstanceOf(AuthRequiredError);
        expect(page.goto).toHaveBeenCalledWith('https://x.com/home');
        expect(page.installInterceptor).not.toHaveBeenCalled();
    });

    it('intercepts the canonical Followers operation, paginates, deduplicates, and respects limit', async () => {
        const command = getRegistry().get('twitter/followers');
        const page = createFollowersPage([
            [followersPayload(['alice', 'bob'], 'cursor-1')],
            [followersPayload(['bob', 'carol', 'dave'], null)],
        ]);

        const rows = await command.func(page, { user: '@elonmusk', limit: 3 });

        expect(rows.map((row) => row.screen_name)).toEqual(['alice', 'bob', 'carol']);
        expect(page.installInterceptor).toHaveBeenCalledWith('/Followers?');
        expect(page.autoScroll).toHaveBeenCalledTimes(1);
        expect(page.waitForCapture).toHaveBeenCalledTimes(2);
        const navigation = page.evaluate.mock.calls.find(([script]) => String(script).includes('history.pushState'));
        expect(String(navigation?.[0])).toContain('/elonmusk/followers');
        expect(String(navigation?.[0])).not.toContain('verified_followers');
    });

    it('typed-fails when the initial Followers capture times out', async () => {
        const command = getRegistry().get('twitter/followers');
        const page = createFollowersPage([]);
        page.waitForCapture.mockRejectedValueOnce(new Error('No network capture'));

        await expect(command.func(page, { user: 'elonmusk', limit: 10 }))
            .rejects.toBeInstanceOf(TimeoutError);
        expect(page.getInterceptedRequests).not.toHaveBeenCalled();
    });

    it('does not silently return partial rows when a later GraphQL page fails', async () => {
        const command = getRegistry().get('twitter/followers');
        const page = createFollowersPage([
            [followersPayload(['alice'], 'cursor-1')],
            [{ errors: [{ code: 88, message: 'Rate limit exceeded' }] }],
        ]);

        await expect(command.func(page, { user: 'elonmusk', limit: 10 }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('returns the upstream-complete first page without scrolling when Twitter terminates the bottom timeline', async () => {
        const command = getRegistry().get('twitter/followers');
        const page = createFollowersPage([[
            followersPayload(['alice', 'bob'], 'decorative-cursor', { terminateBottom: true }),
        ]]);

        const rows = await command.func(page, { user: 'elonmusk', limit: 100 });

        expect(rows.map((row) => row.screen_name)).toEqual(['alice', 'bob']);
        expect(page.autoScroll).not.toHaveBeenCalled();
    });

    it('does not silently return partial rows when a continuation capture times out', async () => {
        const command = getRegistry().get('twitter/followers');
        const page = createFollowersPage([[followersPayload(['alice'], 'cursor-1')]]);
        page.waitForCapture
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('No network capture'));

        await expect(command.func(page, { user: 'elonmusk', limit: 10 }))
            .rejects.toBeInstanceOf(TimeoutError);
    });

    it('surfaces a private-followers hint for an empty timeline object', async () => {
        const command = getRegistry().get('twitter/followers');
        const page = createFollowersPage([[
            { data: { user: { result: { __typename: 'User', timeline: {} } } } },
        ]]);

        await expect(command.func(page, { user: 'private_user', limit: 10 }))
            .rejects.toMatchObject({ hint: expect.stringContaining('followers list to private') });
    });

    it('fails fast when the interceptor returns no follower rows', async () => {
        const command = getRegistry().get('twitter/followers');
        const page = createFollowersPage([[followersPayload([], null)]]);

        await expect(command.func(page, { user: 'elonmusk', limit: 10 }))
            .rejects.toBeInstanceOf(EmptyResultError);
    });
});
