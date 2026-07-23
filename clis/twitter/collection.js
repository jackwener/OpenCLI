import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { extractMedia, extractQuotedTweet, normalizeTwitterScreenName } from './shared.js';
import {
    DEFAULT_USER_TWEETS_PAGE_DELAY_SECONDS,
    MAX_USER_TWEETS_LIMIT,
    MAX_USER_TWEETS_PAGES,
    USER_TWEETS_PAGE_SIZE,
    fetchUserTimelinePage,
    resolveUserTimelineContext,
} from './user-timeline.js';

const RFC3339_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function normalizeUntil(raw) {
    const value = String(raw ?? '').trim();
    if (!RFC3339_TIMESTAMP.test(value)) {
        throw new ArgumentError(
            'twitter collection --until must be an RFC3339 timestamp',
            'Example: opencli twitter collection @jack --until 2026-07-23T00:00:00Z',
        );
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new ArgumentError(
            'twitter collection --until must be an RFC3339 timestamp',
            'Example: opencli twitter collection @jack --until 2026-07-23T00:00:00Z',
        );
    }
    return parsed;
}

function normalizeCollectionLimit(rawLimit) {
    const limit = rawLimit ?? MAX_USER_TWEETS_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_USER_TWEETS_LIMIT) {
        throw new ArgumentError(
            `twitter collection --limit must be an integer between 1 and ${MAX_USER_TWEETS_LIMIT}`,
            'Example: opencli twitter collection @jack --until 2026-07-23T00:00:00Z --limit 250',
        );
    }
    return limit;
}

function normalizeCollectionPageDelaySeconds(rawDelay) {
    const delay = rawDelay ?? DEFAULT_USER_TWEETS_PAGE_DELAY_SECONDS;
    if (!Number.isInteger(delay) || delay < 0 || delay > 60) {
        throw new ArgumentError(
            'twitter collection --page-delay must be an integer between 0 and 60 seconds',
            'Example: opencli twitter collection @jack --until 2026-07-23T00:00:00Z --page-delay 2',
        );
    }
    return delay;
}

function unwrapTweetResult(result) {
    if (!result) return null;
    if (result.__typename === 'TweetWithVisibilityResults' && result.tweet) return result.tweet;
    return result.tweet || result;
}

function relationshipTarget(result, fallbackId = null, contextStatus = 'complete') {
    const tweet = unwrapTweetResult(result);
    const user = tweet?.core?.user_results?.result;
    const rawHandle = user?.legacy?.screen_name || user?.core?.screen_name || null;
    const authorHandle = typeof rawHandle === 'string' && normalizeTwitterScreenName(rawHandle)
        ? normalizeTwitterScreenName(rawHandle)
        : null;
    const rawAuthorId = user?.rest_id || user?.legacy?.id_str || null;
    const authorId = typeof rawAuthorId === 'string' && rawAuthorId.trim() ? rawAuthorId : null;
    const rawPostId = tweet?.rest_id || fallbackId || null;
    const postId = typeof rawPostId === 'string' && rawPostId.trim() ? rawPostId : null;
    const hasVisibleContext = Boolean(tweet?.note_tweet?.note_tweet_results?.result?.text || tweet?.legacy?.full_text);
    const resolvedContextStatus = contextStatus === 'complete' && !hasVisibleContext
        ? (postId ? 'unavailable' : 'unknown')
        : contextStatus;
    return {
        post_id: postId,
        author_handle: authorHandle,
        author_id: authorId,
        url: postId && authorHandle ? `https://x.com/${authorHandle}/status/${postId}` : null,
        context_status: resolvedContextStatus,
    };
}

function extractRelationship(result) {
    const tweet = unwrapTweetResult(result);
    const legacy = tweet?.legacy || {};
    const repostResult = tweet?.retweeted_status_result?.result || legacy.retweeted_status_result?.result || null;
    const repostId = legacy.retweeted_status_id_str || null;
    if (repostResult || repostId) {
        const target = relationshipTarget(repostResult, repostId, repostResult ? 'complete' : 'unknown');
        if (!repostResult || !target.post_id) {
            throw new CommandExecutionError('twitter_collection_unresolved_relationship: repost target is unavailable');
        }
        return { kind: 'repost', target };
    }
    const quoteResult = tweet?.quoted_status_result?.result || legacy.quoted_status_result?.result || null;
    const quoteId = legacy.quoted_status_id_str || null;
    if (legacy.is_quote_status || quoteResult || quoteId) {
        return {
            kind: 'quote',
            target: relationshipTarget(quoteResult, quoteId, quoteResult ? 'complete' : 'unavailable'),
        };
    }
    const replyId = legacy.in_reply_to_status_id_str || null;
    const replyHandle = normalizeTwitterScreenName(legacy.in_reply_to_screen_name || '') || null;
    const replyAuthorId = typeof legacy.in_reply_to_user_id_str === 'string' && legacy.in_reply_to_user_id_str.trim()
        ? legacy.in_reply_to_user_id_str
        : null;
    if (replyId || replyHandle || replyAuthorId) {
        return {
            kind: 'reply',
            target: {
                post_id: replyId,
                author_handle: replyHandle,
                author_id: replyAuthorId,
                url: replyId && replyHandle ? `https://x.com/${replyHandle}/status/${replyId}` : null,
                context_status: replyId ? 'unavailable' : 'unknown',
            },
        };
    }
    return { kind: 'original', target: null };
}

function extractCollectionPost(result, seen) {
    const tweet = unwrapTweetResult(result);
    if (!tweet?.rest_id || typeof tweet.rest_id !== 'string') {
        throw new CommandExecutionError('twitter_collection_protocol_error: timeline post is missing a stable ID');
    }
    if (seen.has(tweet.rest_id)) return null;
    seen.add(tweet.rest_id);
    const legacy = tweet.legacy || {};
    const user = tweet.core?.user_results?.result;
    const author = user?.legacy?.screen_name || user?.core?.screen_name || null;
    if (!author || !normalizeTwitterScreenName(author)) {
        throw new CommandExecutionError('twitter_collection_protocol_error: timeline post is missing an author handle');
    }
    return {
        id: tweet.rest_id,
        author,
        name: user?.legacy?.name || user?.core?.name || '',
        text: tweet.note_tweet?.note_tweet_results?.result?.text || legacy.full_text || '',
        likes: legacy.favorite_count || 0,
        retweets: legacy.retweet_count || 0,
        replies: legacy.reply_count || 0,
        views: Number(tweet.views?.count) || 0,
        is_retweet: Boolean(legacy.retweeted_status_result),
        created_at: legacy.created_at || '',
        url: `https://x.com/${author}/status/${tweet.rest_id}`,
        ...extractMedia(legacy),
        quoted_tweet: extractQuotedTweet(tweet),
        relationship: extractRelationship(tweet),
    };
}

function parseCollectionPage(payload, seen) {
    const result = payload?.data?.user?.result;
    if (!result || typeof result !== 'object') {
        throw new CommandExecutionError('twitter_collection_protocol_error: missing UserTweets result');
    }
    const instructionSets = [
        result.timeline_v2?.timeline?.instructions,
        result.timeline?.timeline?.instructions,
    ].filter(Array.isArray);
    const posts = [];
    let nextCursor = null;
    const visit = (value) => {
        if (!value || typeof value !== 'object') return;
        if (value.type === 'TimelinePinEntry') return;
        if (value.tweet_results?.result) {
            const post = extractCollectionPost(value.tweet_results.result, seen);
            if (post) posts.push(post);
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
    for (const instructions of instructionSets) visit(instructions);
    return [posts, nextCursor];
}

function parseCreatedAt(post) {
    const parsed = new Date(post.created_at);
    if (typeof post.created_at !== 'string' || !post.created_at || Number.isNaN(parsed.getTime())) {
        throw new CommandExecutionError(`twitter_collection_invalid_timestamp: post ${post.id}`);
    }
    return parsed;
}

function completedReceipt(stopReason, until, pagesFetched, oldestSeenAt) {
    return {
        completed: true,
        stop_reason: stopReason,
        requested_until: until.toISOString(),
        pages_fetched: pagesFetched,
        oldest_seen_at: oldestSeenAt ? oldestSeenAt.toISOString() : null,
    };
}

async function paginateCollection({ until, limit, maxPages = MAX_USER_TWEETS_PAGES, fetchPage, wait }) {
    const seen = new Set();
    const seenCursors = new Set();
    const posts = [];
    let cursor = null;
    let oldestSeenAt = null;
    for (let pageIndex = 0; pageIndex < maxPages; pageIndex++) {
        if (pageIndex > 0 && wait) await wait();
        const payload = await fetchPage(cursor, USER_TWEETS_PAGE_SIZE);
        if (payload?.error) {
            throw new CommandExecutionError(`twitter_collection_request_error: UserTweets returned ${payload.error}`);
        }
        const [pagePosts, nextCursor] = parseCollectionPage(payload, seen);
        for (const post of pagePosts) {
            if (posts.length >= limit) {
                throw new CommandExecutionError('twitter_collection_limit_reached: pagination cannot prove completion');
            }
            const createdAt = parseCreatedAt(post);
            if (!oldestSeenAt || createdAt < oldestSeenAt) oldestSeenAt = createdAt;
            posts.push(post);
            if (createdAt <= until) {
                return {
                    posts,
                    receipt: completedReceipt('time_boundary_reached', until, pageIndex + 1, oldestSeenAt),
                };
            }
        }
        if (!nextCursor) {
            return {
                posts,
                receipt: completedReceipt('cursor_exhausted', until, pageIndex + 1, oldestSeenAt),
            };
        }
        if (nextCursor === cursor || seenCursors.has(nextCursor)) {
            throw new CommandExecutionError('twitter_collection_repeated_cursor: pagination cannot prove completion');
        }
        if (posts.length >= limit) {
            throw new CommandExecutionError('twitter_collection_limit_reached: pagination cannot prove completion');
        }
        seenCursors.add(nextCursor);
        cursor = nextCursor;
    }
    throw new CommandExecutionError('twitter_collection_page_guard_hit: pagination cannot prove completion');
}

cli({
    site: 'twitter',
    name: 'collection',
    access: 'read',
    description: 'Fetch a user timeline with relationship facts and a bounded completion receipt.',
    domain: 'x.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'username', type: 'string', positional: true, required: true, help: 'Twitter screen name (with or without @).' },
        { name: 'until', type: 'string', required: true, help: 'RFC3339 lower time boundary that must be reached or exhausted.' },
        { name: 'limit', type: 'int', default: MAX_USER_TWEETS_LIMIT, help: 'Safety ceiling; reaching it is a typed failure.' },
        { name: 'page-delay', type: 'int', default: DEFAULT_USER_TWEETS_PAGE_DELAY_SECONDS, help: 'Seconds to wait between cursor pages.' },
    ],
    columns: ['posts', 'receipt'],
    func: async (page, kwargs) => {
        const until = normalizeUntil(kwargs.until);
        const limit = normalizeCollectionLimit(kwargs.limit);
        const pageDelaySeconds = normalizeCollectionPageDelaySeconds(kwargs['page-delay']);
        const context = await resolveUserTimelineContext(page, kwargs.username, { allowLoggedInDefault: false });
        return paginateCollection({
            until,
            limit,
            fetchPage: (cursor, count) => fetchUserTimelinePage(page, context, cursor, count),
            wait: pageDelaySeconds > 0 ? () => page.wait(pageDelaySeconds) : null,
        });
    },
});

export const __test__ = {
    normalizeUntil,
    normalizeCollectionLimit,
    normalizeCollectionPageDelaySeconds,
    extractRelationship,
    parseCollectionPage,
    paginateCollection,
};
