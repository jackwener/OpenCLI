import { describe, expect, it } from 'vitest';

import { ArgumentError } from '@jackwener/opencli/errors';

const { buildDeviceFollowUrl, extractEntries, joinEntryToTweet, shapeRow, parseDeviceFollow, parseLimit } = await import('./device-follow.js').then((m) => m.__test__);

function tweet(id, userId, overrides = {}) {
    return {
        id_str: id,
        user_id_str: userId,
        full_text: `text-${id}`,
        favorite_count: 10,
        retweet_count: 2,
        reply_count: 1,
        quote_count: 0,
        created_at: 'Sun May 18 12:34:56 +0000 2026',
        ...overrides,
    };
}

function user(id, screenName) {
    return { id_str: id, screen_name: screenName };
}

function entry(tweetId) {
    return {
        entryId: `tweet-${tweetId}`,
        content: { item: { content: { tweet: { id: tweetId } } } },
    };
}

function nonTweetEntry(id = 'cursor-bottom') {
    return {
        entryId: id,
        content: { item: { content: {} } },
    };
}

function payload(tweets, users, entries) {
    return {
        globalObjects: { tweets, users },
        timeline: { id: 'tweet_notifications', instructions: [{ addEntries: { entries } }] },
    };
}

describe('twitter device-follow', () => {
    it('parseLimit accepts 1-200 and rejects everything else without silent clamping', () => {
        expect(parseLimit(undefined)).toBe(20);
        expect(parseLimit(1)).toBe(1);
        expect(parseLimit(200)).toBe(200);
        expect(() => parseLimit(0)).toThrow(ArgumentError);
        expect(() => parseLimit(201)).toThrow(ArgumentError);
        expect(() => parseLimit(1.5)).toThrow(ArgumentError);
        expect(() => parseLimit('abc')).toThrow(ArgumentError);
    });

    it('builds the device_follow URL with required v1.1 params', () => {
        const url = buildDeviceFollowUrl(25);
        expect(url.startsWith('/i/api/2/notifications/device_follow.json?')).toBe(true);
        const params = new URLSearchParams(url.split('?')[1]);
        expect(params.get('count')).toBe('25');
        expect(params.get('tweet_mode')).toBe('extended');
        expect(params.get('include_ext_views')).toBe('true');
        expect(params.get('include_reply_count')).toBe('1');
        expect(params.get('include_quote_count')).toBe('true');
    });

    it('extracts entries from the addEntries instruction shape', () => {
        const p = payload({}, {}, [entry('1'), entry('2')]);
        const entries = extractEntries(p.timeline);
        expect(entries).toHaveLength(2);
        expect(entries[0].entryId).toBe('tweet-1');
    });

    it('extractEntries tolerates missing or empty instructions', () => {
        expect(extractEntries(undefined)).toBeNull();
        expect(extractEntries({})).toBeNull();
        expect(extractEntries({ instructions: [] })).toEqual([]);
        expect(extractEntries({ instructions: [{ addEntries: { entries: [] } }] })).toEqual([]);
    });

    it('joinEntryToTweet pairs the entry tweet id to globalObjects', () => {
        const tweets = { '1': tweet('1', 'u1') };
        const users = { u1: user('u1', 'alice') };
        const out = joinEntryToTweet(entry('1'), tweets, users);
        expect(out?.tweetId).toBe('1');
        expect(out?.tweet.full_text).toBe('text-1');
        expect(out?.user.screen_name).toBe('alice');
    });

    it('joinEntryToTweet returns null when tweet id is missing or unmatched', () => {
        expect(joinEntryToTweet({}, {}, {})).toBeNull();
        expect(joinEntryToTweet(entry('1'), {}, {})).toBeNull();
    });

    it('shapeRow projects the canonical row schema with views=null', () => {
        const row = shapeRow({
            tweetId: '42',
            tweet: tweet('42', 'u1', { favorite_count: 5, retweet_count: 1, reply_count: 7 }),
            user: user('u1', 'bob'),
        });
        expect(row).toEqual({
            id: '42',
            author: 'bob',
            text: 'text-42',
            likes: 5,
            retweets: 1,
            replies: 7,
            views: null,
            created_at: 'Sun May 18 12:34:56 +0000 2026',
            url: 'https://x.com/bob/status/42',
        });
    });

    it('joinEntryToTweet requires a resolved user screen_name before emitting a row URL', () => {
        expect(joinEntryToTweet(entry('1'), { '1': tweet('1', 'missing') }, {})).toBeNull();
        expect(joinEntryToTweet(entry('1'), { '1': tweet('1', 'u1') }, { u1: { id_str: 'u1' } })).toBeNull();
    });

    it('shapeRow uses tweet.text when full_text is absent', () => {
        const row = shapeRow({ tweetId: '7', tweet: { text: 'fallback' }, user: user('u1', 'x') });
        expect(row.text).toBe('fallback');
    });

    it('parseDeviceFollow maps the legacy v1.1 payload to rows', () => {
        const p = payload(
            { '1': tweet('1', 'u1'), '2': tweet('2', 'u2') },
            { u1: user('u1', 'alice'), u2: user('u2', 'bob') },
            [entry('1'), entry('2')],
        );
        const rows = parseDeviceFollow(p, new Set());
        expect(rows?.rows.map((r) => r.author)).toEqual(['alice', 'bob']);
        expect(rows?.rows.every((r) => r.views === null)).toBe(true);
        expect(rows?.rows[0].url).toBe('https://x.com/alice/status/1');
    });

    it('parseDeviceFollow dedupes via the seen set', () => {
        const p = payload(
            { '1': tweet('1', 'u1') },
            { u1: user('u1', 'alice') },
            [entry('1'), entry('1')],
        );
        expect(parseDeviceFollow(p, new Set())?.rows).toHaveLength(1);
    });

    it('parseDeviceFollow returns typed empty metadata for the empty-stream shape', () => {
        const empty = { globalObjects: {}, timeline: { instructions: [{ addEntries: { entries: [] } }] } };
        expect(parseDeviceFollow(empty, new Set())).toEqual({
            rows: [],
            entryCount: 0,
            unmatchedTweetEntries: 0,
            malformedEntries: 0,
        });
    });

    it('parseDeviceFollow returns null for malformed top-level shape', () => {
        expect(parseDeviceFollow({}, new Set())).toBeNull();
        expect(parseDeviceFollow({ globalObjects: {}, timeline: {} }, new Set())).toBeNull();
    });

    it('parseDeviceFollow tracks tweet entries that cannot join to required user identity', () => {
        const parsed = parseDeviceFollow(payload({ '1': tweet('1', 'u1') }, {}, [entry('1')]), new Set());
        expect(parsed).toMatchObject({
            rows: [],
            entryCount: 1,
            unmatchedTweetEntries: 1,
            malformedEntries: 0,
        });
    });

    it('parseDeviceFollow tracks non-empty entries without tweet identity as parser drift', () => {
        const parsed = parseDeviceFollow(payload({}, {}, [nonTweetEntry()]), new Set());
        expect(parsed).toMatchObject({
            rows: [],
            entryCount: 1,
            unmatchedTweetEntries: 0,
            malformedEntries: 1,
        });
    });

});
