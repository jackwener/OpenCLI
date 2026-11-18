import { describe, expect, it } from 'vitest';

import { CommandExecutionError } from '@jackwener/opencli/errors';
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
            avatar: null,
            user_id: null,
        }]);
    });

    it('emits avatar (upscaled to 400x400) and user_id for discovery consumers', () => {
        const rows = __test__.mapTwitterProfileResult({
            rest_id: '12345',
            core: { screen_name: 'u', name: 'U', created_at: 'now' },
            avatar: { image_url: 'https://pbs.twimg.com/profile_images/1/abc_normal.jpg' },
            legacy: { description: 'bio' },
        }, 'u');
        expect(rows[0]).toMatchObject({
            avatar: 'https://pbs.twimg.com/profile_images/1/abc_400x400.jpg',
            user_id: '12345',
        });
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

});
