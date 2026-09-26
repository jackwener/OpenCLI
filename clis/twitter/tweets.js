import fs from 'node:fs';
import path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    sanitizeQueryId,
    extractMedia,
    extractQuotedTweet,
    extractRetweetedTweet,
    collectTweetUrlMap,
    expandTweetUrls,
    describeTwitterApiError,
} from './shared.js';
import { applyTopByEngagement } from './utils.js';
import {
    MAX_USER_TWEETS_PAGES,
    USER_TWEETS_PAGE_SIZE,
    MAX_USER_TWEETS_LIMIT,
    DEFAULT_USER_TWEETS_PAGE_DELAY_SECONDS,
    buildUserTweetsUrl,
    buildUserByScreenNameUrl,
    fetchUserTimelinePage,
    resolveUserTimelineContext,
} from './user-timeline.js';

const MAX_TWEETS_LIMIT = MAX_USER_TWEETS_LIMIT;
const DEFAULT_PAGE_DELAY_SECONDS = DEFAULT_USER_TWEETS_PAGE_DELAY_SECONDS;

function extractTweet(result, seen, { expandUrls = false } = {}) {
    if (!result) return null;
    const tw = result.__typename === 'TweetWithVisibilityResults' && result.tweet
        ? result.tweet
        : (result.tweet || result);
    const legacy = tw.legacy || {};
    if (!tw.rest_id || seen.has(tw.rest_id)) return null;
    seen.add(tw.rest_id);
    const user = tw.core?.user_results?.result;
    const screenName = user?.legacy?.screen_name || user?.core?.screen_name || 'unknown';
    const displayName = user?.legacy?.name || user?.core?.name || '';
    const noteText = tw.note_tweet?.note_tweet_results?.result?.text;
    const isRetweet = Boolean(legacy.retweeted_status_result || legacy.full_text?.startsWith('RT @'));
    let text = noteText || legacy.full_text || '';
    if (expandUrls) text = expandTweetUrls(text, collectTweetUrlMap(tw));
    const quoted = extractQuotedTweet(tw);
    if (quoted && expandUrls) {
        const q = (tw.quoted_status_result?.result ?? legacy.quoted_status_result?.result) || {};
        quoted.text = expandTweetUrls(quoted.text, collectTweetUrlMap(q.tweet || q));
    }
    return {
        id: tw.rest_id,
        author: screenName,
        name: displayName,
        text,
        likes: legacy.favorite_count || 0,
        retweets: legacy.retweet_count || 0,
        replies: legacy.reply_count || 0,
        views: Number(tw.views?.count) || 0,
        is_retweet: isRetweet,
        created_at: legacy.created_at || '',
        url: `https://x.com/${screenName}/status/${tw.rest_id}`,
        ...extractMedia(legacy),
        quoted_tweet: quoted,
        retweeted_tweet: extractRetweetedTweet(tw, { expandUrls }),
    };
}

function parseUserTweets(data, seen, options = {}) {
    const tweets = [];
    let nextCursor = null;
    const result = data?.data?.user?.result || {};
    const instructionSets = [
        result.timeline_v2?.timeline?.instructions,
        result.timeline?.timeline?.instructions,
    ].filter(Array.isArray);
    const instructions = instructionSets.flat();
    const visit = (value) => {
        if (!value || typeof value !== 'object') return;
        if (value.type === 'TimelinePinEntry') return;
        if (value.tweet_results?.result) {
            const tweet = extractTweet(value.tweet_results.result, seen, options);
            if (tweet) tweets.push(tweet);
        }
        if (
            (value.entryType === 'TimelineTimelineCursor' || value.__typename === 'TimelineTimelineCursor')
            && (value.cursorType === 'Bottom' || value.cursorType === 'ShowMore')
            && value.value
        ) {
            nextCursor = value.value;
        }
        if (Array.isArray(value)) {
            for (const item of value) visit(item);
            return;
        }
        for (const child of Object.values(value)) {
            if (child && typeof child === 'object') visit(child);
        }
    };
    visit(instructions);
    return { tweets, nextCursor };
}

function normalizeLimit(rawLimit) {
    const limit = rawLimit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_TWEETS_LIMIT) {
        throw new ArgumentError(
            `twitter tweets --limit must be an integer between 1 and ${MAX_TWEETS_LIMIT}`,
            'Example: opencli twitter tweets @jack --limit 250',
        );
    }
    return limit;
}

function normalizePageDelaySeconds(rawDelay) {
    const delay = rawDelay ?? DEFAULT_PAGE_DELAY_SECONDS;
    if (!Number.isInteger(delay) || delay < 0 || delay > 60) {
        throw new ArgumentError(
            'twitter tweets --page-delay must be an integer between 0 and 60 seconds',
            'Example: opencli twitter tweets @jack --limit 250 --page-delay 2',
        );
    }
    return delay;
}

function normalizeCursor(rawCursor) {
    if (rawCursor === undefined || rawCursor === null || rawCursor === '') return null;
    const cursor = String(rawCursor).trim();
    if (!cursor) return null;
    return cursor;
}

function normalizeCursorFile(rawPath) {
    if (rawPath === undefined || rawPath === null || rawPath === '') return null;
    const value = String(rawPath).trim();
    if (!value) return null;
    return path.resolve(value);
}

// Persist the resume point for the next run. An empty file means the timeline
// was exhausted, so callers can tell "done" apart from "stopped early".
function writeCursorFile(cursorFile, cursor) {
    if (!cursorFile) return;
    fs.mkdirSync(path.dirname(cursorFile), { recursive: true });
    fs.writeFileSync(cursorFile, cursor ? `${cursor}\n` : '');
}

cli({
    site: 'twitter',
    name: 'tweets',
    access: 'read',
    description: "Fetch a Twitter user's most recent tweets (chronological, excludes pinned; defaults to the logged-in user when no username is given)",
    domain: 'x.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'username', type: 'string', positional: true, help: 'Twitter screen name (with or without @). Defaults to the logged-in user when omitted.' },
        { name: 'limit', type: 'int', default: 20, help: `Max tweets to return (1-${MAX_TWEETS_LIMIT}; fetched across cursor pages)` },
        { name: 'page-delay', type: 'int', default: DEFAULT_PAGE_DELAY_SECONDS, help: 'Seconds to wait between paginated timeline requests to reduce rate-limit risk. Use 0 to disable.' },
        { name: 'top-by-engagement', type: 'int', default: 0, help: 'When set to N>0, re-rank the tweets by weighted engagement (likes×1 + retweets×3 + replies×2 + bookmarks×5 + log10(views+1)×0.5) and return the top N. Default 0 keeps the chronological ordering.' },
        { name: 'expand-urls', type: 'bool', default: false, help: 'Replace t.co short links in text (including quoted/retweeted text) with their expanded URLs.' },
        { name: 'cursor', type: 'string', help: 'Resume pagination from a bottom cursor saved by a previous run (see --cursor-file). Useful for gentle, resumable backfills of large timelines.' },
        { name: 'cursor-file', type: 'string', help: 'Write the next bottom cursor to this file when the run stops before the timeline is exhausted (empty file = exhausted). Pass its content back via --cursor to continue. Makes --limit a soft target (whole pages are returned) so no tweet falls between runs.' },
    ],
    columns: ['id', 'author', 'created_at', 'is_retweet', 'text', 'likes', 'retweets', 'replies', 'views', 'url', 'has_media', 'media_urls', 'media_posters', 'quoted_tweet', 'retweeted_tweet'],
    func: async (page, kwargs) => {
        const limit = normalizeLimit(kwargs.limit);
        const pageDelaySeconds = normalizePageDelaySeconds(kwargs['page-delay']);
        const expandUrls = Boolean(kwargs['expand-urls']);
        const resumeCursor = normalizeCursor(kwargs.cursor);
        const cursorFile = normalizeCursorFile(kwargs['cursor-file']);
        const context = await resolveUserTimelineContext(page, kwargs.username, { allowLoggedInDefault: true });
        const { username } = context;
        const seen = new Set();
        const all = [];
        let cursor = resumeCursor;
        let exhausted = false;
        // Runaway guard only; --limit and cursor exhaustion control normal pagination.
        for (let i = 0; i < MAX_USER_TWEETS_PAGES && all.length < limit; i++) {
            if (i > 0 && pageDelaySeconds > 0) {
                await page.wait(pageDelaySeconds);
            }
            const fetchCount = Math.min(USER_TWEETS_PAGE_SIZE, limit - all.length + 10);
            const data = await fetchUserTimelinePage(page, context, cursor, fetchCount);
            if (data?.error) {
                if (all.length === 0) {
                    // Nothing collected yet: keep the resume point so the caller can retry
                    // the same page after the cooldown, then surface the real failure.
                    writeCursorFile(cursorFile, cursor);
                    throw new CommandExecutionError(describeTwitterApiError('UserTweets', data.error));
                }
                // Mid-pagination failure: return what we have; `cursor` still points at
                // the page that failed so a resumed run picks up exactly there.
                break;
            }
            const { tweets, nextCursor } = parseUserTweets(data, seen, { expandUrls });
            all.push(...tweets);
            if (!nextCursor || nextCursor === cursor) {
                exhausted = true;
                break;
            }
            cursor = nextCursor;
        }
        writeCursorFile(cursorFile, exhausted ? null : cursor);
        if (all.length === 0) {
            if (resumeCursor) return []; // resumed run: an empty tail is a valid end, not an error
            throw new EmptyResultError(`@${username} has no recent tweets`, 'Account may be private or suspended');
        }
        // Cursors point at page boundaries, so with --cursor-file we return every
        // row of the last fetched page (slightly over --limit) instead of dropping
        // rows that the next resumed run could never see again.
        const rows = cursorFile ? all : all.slice(0, limit);
        return applyTopByEngagement(rows, kwargs['top-by-engagement']);
    },
});

export const __test__ = {
    MAX_TWEETS_LIMIT,
    sanitizeQueryId,
    buildUserTweetsUrl,
    buildUserByScreenNameUrl,
    extractTweet,
    parseUserTweets,
    normalizeLimit,
    normalizePageDelaySeconds,
    normalizeCursor,
    normalizeCursorFile,
    writeCursorFile,
};
