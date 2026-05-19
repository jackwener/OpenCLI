/**
 * Twitter `/i/timeline` device-follow notification stream, i.e. the
 * curated tweet list aggregated under a bell-icon "new posts from
 * @userA and N others" notification. Direct GET /i/timeline redirects
 * to /home; the data is only reachable via the legacy v1.1 REST
 * endpoint `/i/api/2/notifications/device_follow.json`.
 *
 * Endpoint discovery and field-mapping originally proposed by @traddo
 * in issue #1628.
 */
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { TWITTER_BEARER_TOKEN, applyTopByEngagement } from './utils.js';

const DEVICE_FOLLOW_PATH = '/i/api/2/notifications/device_follow.json';
const MAX_LIMIT = 200;

function parseLimit(value) {
    if (value === undefined || value === null || value === '') return 20;
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
        throw new ArgumentError(`--limit must be an integer between 1 and ${MAX_LIMIT}`);
    }
    return limit;
}

function buildDeviceFollowUrl(count) {
    const params = new URLSearchParams({
        include_profile_interstitial_type: '1',
        include_blocking: '1',
        include_blocked_by: '1',
        include_followed_by: '1',
        include_want_retweets: '1',
        include_mute_edge: '1',
        include_can_dm: '1',
        include_can_media_tag: '1',
        include_ext_has_nft_avatar: '1',
        include_ext_is_blue_verified: '1',
        include_ext_verified_type: '1',
        skip_status: '1',
        cards_platform: 'Web-12',
        include_cards: '1',
        include_ext_alt_text: 'true',
        include_quote_count: 'true',
        include_reply_count: '1',
        tweet_mode: 'extended',
        include_ext_views: 'true',
        count: String(count),
    });
    return `${DEVICE_FOLLOW_PATH}?${params.toString()}`;
}

function extractEntries(timeline) {
    if (!timeline || !Array.isArray(timeline.instructions)) return null;
    const out = [];
    for (const inst of timeline.instructions) {
        const entries = inst?.addEntries?.entries;
        if (Array.isArray(entries)) out.push(...entries);
    }
    return out;
}

function joinEntryToTweet(entry, tweets, users) {
    const tweetId = entry?.content?.item?.content?.tweet?.id;
    if (!tweetId) return null;
    const tw = tweets?.[tweetId];
    if (!tw) return null;
    const user = users?.[tw.user_id_str] || null;
    if (typeof user?.screen_name !== 'string' || !user.screen_name) return null;
    return { tweetId, tweet: tw, user };
}

function shapeRow({ tweetId, tweet, user }) {
    const screenName = user.screen_name;
    return {
        id: tweetId,
        author: screenName,
        text: tweet?.full_text || tweet?.text || '',
        likes: tweet?.favorite_count ?? 0,
        retweets: tweet?.retweet_count ?? 0,
        replies: tweet?.reply_count ?? 0,
        // The legacy v1.1 endpoint does not return view counts even with
        // include_ext_views=true; surface null rather than a 0 sentinel
        // that would lie about real engagement (typed-errors §3).
        views: null,
        created_at: tweet?.created_at || '',
        url: `https://x.com/${screenName}/status/${tweetId}`,
    };
}

function parseDeviceFollow(payload, seen) {
    if (!payload?.globalObjects || typeof payload.globalObjects !== 'object') return null;
    const tweets = payload?.globalObjects?.tweets || {};
    const users = payload?.globalObjects?.users || {};
    if (typeof tweets !== 'object' || typeof users !== 'object') return null;
    const entries = extractEntries(payload?.timeline);
    if (!entries) return null;
    const rows = [];
    let unmatchedTweetEntries = 0;
    let malformedEntries = 0;
    for (const entry of entries) {
        const hasTweetEntry = Boolean(entry?.content?.item?.content?.tweet?.id);
        if (!hasTweetEntry) {
            malformedEntries++;
            continue;
        }
        const joined = joinEntryToTweet(entry, tweets, users);
        if (!joined) {
            unmatchedTweetEntries++;
            continue;
        }
        if (seen.has(joined.tweetId)) continue;
        seen.add(joined.tweetId);
        rows.push(shapeRow(joined));
    }
    return { rows, entryCount: entries.length, unmatchedTweetEntries, malformedEntries };
}

cli({
    site: 'twitter',
    name: 'device-follow',
    access: 'read',
    description: 'Read the /i/timeline device-follow notification stream (tweets aggregated under a bell-icon "new posts from @userA and N others" notification)',
    domain: 'x.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 20, help: `Maximum number of tweets to return (1-${MAX_LIMIT}, default 20)` },
        { name: 'top-by-engagement', type: 'int', default: 0, help: 'When set to N>0, re-rank by weighted engagement and return the top N. Default 0 keeps upstream ordering.' },
    ],
    columns: ['id', 'author', 'text', 'likes', 'retweets', 'replies', 'views', 'created_at', 'url'],
    func: async (page, kwargs) => {
        const limit = parseLimit(kwargs.limit);
        const cookies = await page.getCookies({ url: 'https://x.com' });
        const ct0 = cookies.find((c) => c.name === 'ct0')?.value || null;
        if (!ct0) throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');

        const apiUrl = buildDeviceFollowUrl(limit);
        const headers = JSON.stringify({
            Authorization: `Bearer ${decodeURIComponent(TWITTER_BEARER_TOKEN)}`,
            'X-Csrf-Token': ct0,
            'X-Twitter-Auth-Type': 'OAuth2Session',
            'X-Twitter-Active-User': 'yes',
        });
        const data = await page.evaluate(`async () => {
        try {
          const r = await fetch("${apiUrl}", { method: "GET", headers: ${headers}, credentials: 'include' });
          if (!r.ok) return { error: r.status };
          try {
            return await r.json();
          } catch (e) {
            return { errorKind: 'non_json', detail: String(e && e.message || e) };
          }
        } catch (e) {
          return { errorKind: 'exception', detail: String(e && e.message || e) };
        }
      }`);
        if (data?.errorKind === 'non_json') {
            throw new CommandExecutionError(`Twitter device-follow returned non-JSON response: ${data.detail || 'unknown parse error'}`);
        }
        if (data?.errorKind === 'exception') {
            throw new CommandExecutionError(`Twitter device-follow fetch failed: ${data.detail || 'unknown error'}`);
        }
        if (data?.error) {
            if (data.error === 401 || data.error === 403) {
                throw new AuthRequiredError('x.com', `Twitter device-follow returned HTTP ${data.error}`);
            }
            throw new CommandExecutionError(`HTTP ${data.error}: Failed to fetch device-follow notification stream.`);
        }
        const parsed = parseDeviceFollow(data, new Set());
        if (!parsed) {
            throw new CommandExecutionError('Twitter device-follow response was missing the expected timeline/globalObjects shape.');
        }
        if (parsed.malformedEntries > 0 || parsed.unmatchedTweetEntries > 0) {
            throw new CommandExecutionError('Twitter device-follow entries could not be joined to tweet/user objects.');
        }
        if (parsed.rows.length === 0) {
            throw new EmptyResultError('twitter device-follow', 'No device-follow notification tweets found.');
        }
        const rows = parsed.rows;
        const trimmed = rows.slice(0, limit);
        return applyTopByEngagement(trimmed, kwargs['top-by-engagement']);
    },
});

export const __test__ = {
    buildDeviceFollowUrl,
    extractEntries,
    joinEntryToTweet,
    shapeRow,
    parseDeviceFollow,
    parseLimit,
};
