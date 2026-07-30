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

    it('reads the current UserByScreenName profile containers after X removed result.legacy (#2188)', () => {
        // Captures the field names and containers observed in a live
        // UserByScreenName response. X renamed these keys as well as moving them,
        // so searching the tree for the old legacy key names cannot recover them.
        const rows = __test__.mapTwitterProfileResult({
            core: {
                screen_name: 'relocated_user',
                name: 'Relocated User',
                created_at: 'Sun Mar 20 00:00:00 +0000 2011',
            },
            relationship_counts: { followers: 7100000, following: 42 },
            tweet_counts: { tweets: 128 },
            action_counts: { favorites_count: 9 },
            profile_bio: { description: 'current bio text' },
            location: { location: 'Earth' },
            website: { url: 'https://example.com' },
            verification: { verified: true },
        }, 'fallback');

        expect(rows[0]).toMatchObject({
            screen_name: 'relocated_user',
            name: 'Relocated User',
            bio: 'current bio text',
            location: 'Earth',
            url: 'https://example.com',
            followers: 7100000,
            following: 42,
            tweets: 128,
            likes: 9,
            verified: true,
            created_at: 'Sun Mar 20 00:00:00 +0000 2011',
        });
    });

    it('prefers current profile containers while retaining legacy fallbacks', () => {
        const rows = __test__.mapTwitterProfileResult({
            core: { screen_name: 'u', name: 'U', created_at: 'now' },
            legacy: {
                description: 'old bio',
                followers_count: 100,
                friends_count: 10,
                statuses_count: 5,
                favourites_count: 2,
            },
            relationship_counts: { followers: 200, following: 20 },
            tweet_counts: { tweets: 15 },
            action_counts: { favorites_count: 12 },
            profile_bio: { description: 'current bio' },
        }, 'fallback');

        expect(rows[0]).toMatchObject({
            bio: 'current bio',
            followers: 200,
            following: 20,
            tweets: 15,
            likes: 12,
        });
    });

    it('does not read same-named values from unrelated nested entities', () => {
        const rows = __test__.mapTwitterProfileResult({
            core: { screen_name: 'u', name: 'U', created_at: 'now' },
            pinned_tweet: {
                relationship_counts: { followers: 999999, following: 999999 },
                action_counts: { favorites_count: 999999 },
                profile_bio: { description: 'not a user bio' },
            },
        }, 'fallback');

        expect(rows[0]).toMatchObject({
            bio: '',
            followers: 0,
            following: 0,
            tweets: 0,
            likes: 0,
        });
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
