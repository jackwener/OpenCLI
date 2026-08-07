import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { sanitizeQueryId, extractMedia, extractQuotedTweet, describeTwitterApiError } from './shared.js';
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

function extractTweet(result, seen) {
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
    return {
        id: tw.rest_id,
        author: screenName,
        name: displayName,
        text: noteText || legacy.full_text || '',
        likes: legacy.favorite_count || 0,
        retweets: legacy.retweet_count || 0,
        replies: legacy.reply_count || 0,
        views: Number(tw.views?.count) || 0,
        is_retweet: isRetweet,
        created_at: legacy.created_at || '',
        url: `https://x.com/${screenName}/status/${tw.rest_id}`,
        ...extractMedia(legacy),
        quoted_tweet: extractQuotedTweet(tw),
    };
}

function parseUserTweets(data, seen) {
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
            const tweet = extractTweet(value.tweet_results.result, seen);
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
    ],
    columns: ['id', 'author', 'created_at', 'is_retweet', 'text', 'likes', 'retweets', 'replies', 'views', 'url', 'has_media', 'media_urls', 'media_posters', 'quoted_tweet'],
    func: async (page, kwargs) => {
        const limit = normalizeLimit(kwargs.limit);
        const pageDelaySeconds = normalizePageDelaySeconds(kwargs['page-delay']);
        const context = await resolveUserTimelineContext(page, kwargs.username, { allowLoggedInDefault: true });
        const { username } = context;
        const seen = new Set();
        const all = [];
        let cursor = null;
        // Runaway guard only; --limit and cursor exhaustion control normal pagination.
        for (let i = 0; i < MAX_USER_TWEETS_PAGES && all.length < limit; i++) {
            if (i > 0 && pageDelaySeconds > 0) {
                await page.wait(pageDelaySeconds);
            }
            const fetchCount = Math.min(USER_TWEETS_PAGE_SIZE, limit - all.length + 10);
            const data = await fetchUserTimelinePage(page, context, cursor, fetchCount);
            if (data?.error) {
                if (all.length === 0) throw new CommandExecutionError(describeTwitterApiError('UserTweets', data.error));
                break;
            }
            const { tweets, nextCursor } = parseUserTweets(data, seen);
            all.push(...tweets);
            if (!nextCursor || nextCursor === cursor) break;
            cursor = nextCursor;
        }
        if (all.length === 0) throw new EmptyResultError(`@${username} has no recent tweets`, 'Account may be private or suspended');
        return applyTopByEngagement(all.slice(0, limit), kwargs['top-by-engagement']);
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
};
