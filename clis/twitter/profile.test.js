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
