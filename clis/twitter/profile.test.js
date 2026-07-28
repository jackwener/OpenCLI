import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { __test__ } from './profile.js';

describe('twitter profile command', () => {
    it('maps current result.core profile fields while preserving legacy fallback fields', () => {
        const rows = __test__.mapTwitterProfileResult({
            core: {
                screen_name: 'AstroHanRay',
                name: 'AstroHan',
                created_at: 'Sun Mar 20 00:00:00 +0000 2011',
            },
            legacy: {
                screen_name: null,
                name: null,
                description: 'bio text',
                location: 'legacy location',
                followers_count: 117,
                friends_count: 12,
                statuses_count: 30,
                favourites_count: 4,
                verified: false,
                entities: { url: { urls: [{ expanded_url: 'https://example.com' }] } },
            },
            location: { location: 'core location' },
            is_blue_verified: true,
        }, 'fallback');

        expect(rows).toEqual([{
            screen_name: 'AstroHanRay',
            name: 'AstroHan',
            bio: 'bio text',
            location: 'core location',
            url: 'https://example.com',
            followers: 117,
            following: 12,
            tweets: 30,
            likes: 4,
            verified: true,
            created_at: 'Sun Mar 20 00:00:00 +0000 2011',
        }]);
    });

    it('falls back to legacy profile fields for older UserByScreenName responses', () => {
        const rows = __test__.mapTwitterProfileResult({
            legacy: {
                screen_name: 'legacy_user',
                name: 'Legacy Name',
                created_at: 'Wed Jan 01 00:00:00 +0000 2020',
                location: 'legacy location',
            },
        }, 'fallback');

        expect(rows[0]).toMatchObject({
            screen_name: 'legacy_user',
            name: 'Legacy Name',
            created_at: 'Wed Jan 01 00:00:00 +0000 2020',
            location: 'legacy location',
        });
    });

    it('recovers followers/following/tweets/likes/bio after X relocates them out of result.legacy (#2188)', () => {
        // Regression for #2188: name/screen_name/created_at/verified stay correct
        // (already read from result.core), but X moved the counts and the bio into
        // a new container, so the legacy-only reads returned 0 / ''. The resolver
        // must find them wherever they now live, without knowing the exact path.
        const rows = __test__.mapTwitterProfileResult({
            core: {
                screen_name: 'relocated_user',
                name: 'Relocated User',
                created_at: 'Sun Mar 20 00:00:00 +0000 2011',
            },
            legacy: {
                // legacy still exists but the counts and description are gone from it
                location: 'Earth',
                verified: false,
            },
            relationship_counts: { followers_count: 7100000, friends_count: 42, statuses_count: 128 },
            engagement: { favourites_count: 9 },
            profile_bio: { description: 'relocated bio text' },
            is_blue_verified: true,
        }, 'fallback');

        expect(rows[0]).toMatchObject({
            screen_name: 'relocated_user',
            name: 'Relocated User',
            bio: 'relocated bio text',
            followers: 7100000,
            following: 42,
            tweets: 128,
            likes: 9,
            verified: true,
            created_at: 'Sun Mar 20 00:00:00 +0000 2011',
        });
    });

    it('prefers the canonical legacy counts/bio over a deeper decoy occurrence', () => {
        // A nested pinned-tweet copy must never shadow the user-level field. The
        // explicit legacy check plus BFS shallow-preference keeps legacy winning.
        const rows = __test__.mapTwitterProfileResult({
            core: { screen_name: 'u', name: 'U', created_at: 'now' },
            legacy: {
                description: 'the real bio',
                followers_count: 100,
                friends_count: 10,
                statuses_count: 5,
                favourites_count: 2,
            },
            pinned_tweet: {
                legacy: { favourites_count: 999999, description: 'a tweet, not a bio' },
            },
        }, 'fallback');

        expect(rows[0]).toMatchObject({
            bio: 'the real bio',
            followers: 100,
            following: 10,
            tweets: 5,
            likes: 2,
        });
    });

    it('never falls back into an embedded tweet when the user field is absent', () => {
        // Shallowest-wins alone does not save us here: with no user-level
        // favourites_count/description anywhere, an unrestricted BFS descends into
        // pinned_tweet and reports a tweet's like count as the user's likes and its
        // text as the bio. Wrong-but-confident data is worse than 0 / ''.
        const rows = __test__.mapTwitterProfileResult({
            core: { screen_name: 'u', name: 'U', created_at: 'now' },
            legacy: { location: 'Earth' },
            pinned_tweet: {
                legacy: { favourites_count: 999999, description: 'a tweet, not a bio' },
            },
        }, 'fallback');

        expect(rows[0]).toMatchObject({ likes: 0, bio: '' });
    });

    it('returns 0 / empty string when a count or bio is absent everywhere', () => {
        const rows = __test__.mapTwitterProfileResult({
            core: { screen_name: 'sparse', name: 'Sparse', created_at: 'now' },
            legacy: {},
        }, 'fallback');

        expect(rows[0]).toMatchObject({
            bio: '',
            followers: 0,
            following: 0,
            tweets: 0,
            likes: 0,
        });
    });

    it('resolveCount / resolveText ignore wrong-typed and empty values', () => {
        // A count that arrives as a numeric string must not be accepted as a number,
        // and an empty/whitespace description must not shadow a populated one deeper.
        expect(__test__.resolveCount({ legacy: { followers_count: '123' }, counts: { followers_count: 7 } }, 'followers_count')).toBe(7);
        expect(__test__.resolveText({ legacy: { description: '   ' }, bio: { description: 'real' } }, 'description')).toBe('real');
        expect(__test__.resolveCount({ legacy: {} }, 'followers_count')).toBe(0);
        expect(__test__.resolveText({ legacy: {} }, 'description')).toBe('');
    });

    it('throws typed when the profile result is structurally malformed', () => {
        expect(() => __test__.mapTwitterProfileResult(null, 'jack')).toThrow(CommandExecutionError);
        expect(() => __test__.mapTwitterProfileResult([], 'jack')).toThrow(CommandExecutionError);
        expect(() => __test__.mapTwitterProfileResult({}, 'jack')).toThrow(CommandExecutionError);
        expect(() => __test__.mapTwitterProfileResult({ __typename: 'UserUnavailable' }, 'jack')).toThrow(CommandExecutionError);
        expect(() => __test__.mapTwitterProfileResult({ legacy: {}, core: {} }, 'jack')).toThrow(CommandExecutionError);
    });

    it('rejects invalid explicit usernames before navigation', async () => {
        const command = getRegistry().get('twitter/profile');
        const page = {
            goto: vi.fn(),
            wait: vi.fn(),
            getCookies: vi.fn(),
            evaluate: vi.fn(),
        };

        await expect(command.func(page, { username: 'viewer/extra' })).rejects.toBeInstanceOf(ArgumentError);
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.getCookies).not.toHaveBeenCalled();
        expect(page.evaluate).not.toHaveBeenCalled();
    });

    it('rejects route-like AppTabBar hrefs instead of navigating to that route profile', async () => {
        const command = getRegistry().get('twitter/profile');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn(),
            evaluate: vi.fn(async (script) => {
                if (String(script).includes('AppTabBar_Profile_Link')) return '/home';
                throw new Error(`Unexpected evaluate: ${String(script).slice(0, 80)}`);
            }),
        };

        await expect(command.func(page, {})).rejects.toBeInstanceOf(AuthRequiredError);
        expect(page.goto).toHaveBeenCalledWith('https://x.com/home');
        expect(page.goto).toHaveBeenCalledTimes(1);
        expect(page.getCookies).not.toHaveBeenCalled();
    });

    it('unwraps Browser Bridge envelopes around UserByScreenName payloads', async () => {
        const command = getRegistry().get('twitter/profile');
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn().mockResolvedValue([{ name: 'ct0', value: 'csrf' }]),
            evaluate: vi.fn()
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({
                    session: 'site:twitter',
                    data: {
                        ok: true,
                        result: {
                            core: { screen_name: 'core_user', name: 'Core User', created_at: 'now' },
                            legacy: { description: 'bio' },
                        },
                    },
                }),
        };

        await expect(command.func(page, { username: 'core_user' })).resolves.toEqual([
            expect.objectContaining({
                screen_name: 'core_user',
                name: 'Core User',
                bio: 'bio',
                created_at: 'now',
            }),
        ]);
    });

    it('maps GraphQL auth and not-found envelopes to typed failures', async () => {
        const command = getRegistry().get('twitter/profile');
        const createPage = (payload) => ({
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            getCookies: vi.fn().mockResolvedValue([{ name: 'ct0', value: 'csrf' }]),
            evaluate: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(payload),
        });

        await expect(command.func(createPage({ ok: false, auth: true, error: 'HTTP 401' }), { username: 'jack' }))
            .rejects.toBeInstanceOf(AuthRequiredError);
        await expect(command.func(createPage({ ok: false, notFound: true, error: 'User @missing not found' }), { username: 'missing' }))
            .rejects.toBeInstanceOf(EmptyResultError);
        await expect(command.func(createPage({ session: 'site:twitter', data: [] }), { username: 'jack' }))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });
});
