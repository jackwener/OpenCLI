import { extractMedia } from './shared.js';
import { TWITTER_BEARER_TOKEN } from './utils.js';

export { TWITTER_BEARER_TOKEN };

const TWEET_DETAIL_QUERY_ID = 'nBS-WpgA6ZG0CyNHD517JQ';

const FEATURES = {
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    longform_notetweets_consumption_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    freedom_of_speech_not_reach_fetch_enabled: true,
};

const FIELD_TOGGLES = { withArticleRichContentState: true, withArticlePlainText: false };

export function buildTweetDetailUrl(tweetId, cursor) {
    const vars = {
        focalTweetId: tweetId,
        referrer: 'tweet',
        with_rux_injections: false,
        includePromotedContent: false,
        rankingMode: 'Recency',
        withCommunity: true,
        withQuickPromoteEligibilityTweetFields: true,
        withBirdwatchNotes: true,
        withVoice: true,
    };
    if (cursor)
        vars.cursor = cursor;
    return `/i/api/graphql/${TWEET_DETAIL_QUERY_ID}/TweetDetail`
        + `?variables=${encodeURIComponent(JSON.stringify(vars))}`
        + `&features=${encodeURIComponent(JSON.stringify(FEATURES))}`
        + `&fieldToggles=${encodeURIComponent(JSON.stringify(FIELD_TOGGLES))}`;
}

export function extractTweet(r, seen) {
    if (!r)
        return null;
    const tw = r.tweet || r;
    const visibleTweet = tw.__typename === 'TweetWithVisibilityResults' && tw.tweet ? tw.tweet : tw;
    const l = visibleTweet.legacy || {};
    if (!visibleTweet.rest_id || seen.has(visibleTweet.rest_id))
        return null;
    seen.add(visibleTweet.rest_id);
    const u = visibleTweet.core?.user_results?.result;
    const noteText = visibleTweet.note_tweet?.note_tweet_results?.result?.text;
    const screenName = u?.legacy?.screen_name || u?.core?.screen_name || 'unknown';
    return {
        id: visibleTweet.rest_id,
        author: screenName,
        text: noteText || l.full_text || '',
        likes: l.favorite_count || 0,
        retweets: l.retweet_count || 0,
        in_reply_to: l.in_reply_to_status_id_str || undefined,
        created_at: l.created_at,
        url: `https://x.com/${screenName}/status/${visibleTweet.rest_id}`,
        ...extractMedia(l),
    };
}

export function parseTweetDetail(data, seen) {
    const tweets = [];
    let nextCursor = null;
    const instructions = data?.data?.threaded_conversation_with_injections_v2?.instructions
        || data?.data?.tweetResult?.result?.timeline?.instructions
        || [];
    for (const inst of instructions) {
        for (const entry of inst.entries || []) {
            const c = entry.content;
            if (c?.entryType === 'TimelineTimelineCursor' || c?.__typename === 'TimelineTimelineCursor') {
                if (c.cursorType === 'Bottom' || c.cursorType === 'ShowMore')
                    nextCursor = c.value;
                continue;
            }
            if (entry.entryId?.startsWith('cursor-bottom-') || entry.entryId?.startsWith('cursor-showMore-')) {
                nextCursor = c?.itemContent?.value || c?.value || nextCursor;
                continue;
            }
            const tw = extractTweet(c?.itemContent?.tweet_results?.result, seen);
            if (tw)
                tweets.push(tw);
            for (const item of c?.items || []) {
                const nested = extractTweet(item.item?.itemContent?.tweet_results?.result, seen);
                if (nested)
                    tweets.push(nested);
            }
        }
    }
    return { tweets, nextCursor };
}

export function extractTweetId(input) {
    const raw = String(input || '').trim();
    const urlMatch = raw.match(/\/status\/(\d+)/);
    return urlMatch ? urlMatch[1] : raw;
}
