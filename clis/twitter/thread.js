import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { BROWSER_JSON_SNIFF_FN, throwIfLoginWall } from '@jackwener/opencli/utils';
import { extractAuthorAvatar, extractMedia, extractCard, extractQuotedTweet, describeTwitterApiError } from './shared.js';
import { TWITTER_BEARER_TOKEN, applyTopByEngagement } from './utils.js';
// ── Twitter GraphQL constants ──────────────────────────────────────────
const TWEET_DETAIL_QUERY_ID = 'nBS-WpgA6ZG0CyNHD517JQ';
const FEATURES = {
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    // Without this flag TweetDetail omits views.count entirely and every row reports '0'.
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    freedom_of_speech_not_reach_fetch_enabled: true,
};
const FIELD_TOGGLES = { withArticleRichContentState: true, withArticlePlainText: false };
// Recency ends the reply feed early on busy posts (26 of ~380 replies in one case);
// Relevance keeps paging and also offers the "Show probable spam" (ShowMoreThreads) cursor.
const RANKING_MODES = { relevance: 'Relevance', recency: 'Recency' };
const MAX_PAGES = 50;
// X occasionally returns one empty page mid-thread; two in a row means the feed is done.
const EMPTY_PAGES_TO_END = 2;
// Bottom, ShowMore, ShowMoreThreads and ShowMoreThreadsPrompt all lead to more replies.
const NEXT_CURSOR_ENTRY = /^cursor-(bottom|showmore)/i;
function buildTweetDetailUrl(tweetId, cursor, rankingMode = 'Relevance') {
    const vars = {
        focalTweetId: tweetId,
        referrer: 'tweet',
        with_rux_injections: false,
        includePromotedContent: false,
        rankingMode,
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
function extractTweet(r, seen) {
    if (!r)
        return null;
    const tw = r.tweet || r;
    const l = tw.legacy || {};
    if (!tw.rest_id || seen.has(tw.rest_id))
        return null;
    seen.add(tw.rest_id);
    const u = tw.core?.user_results?.result;
    const noteText = tw.note_tweet?.note_tweet_results?.result?.text;
    const screenName = u?.legacy?.screen_name || u?.core?.screen_name || 'unknown';
    const bio = u?.legacy?.description || '';
    return {
        id: tw.rest_id,
        author: screenName,
        author_avatar: extractAuthorAvatar(u),
        author_verified: Boolean(u?.is_blue_verified || u?.legacy?.verified),
        bio,
        text: noteText || l.full_text || '',
        likes: l.favorite_count || 0,
        retweets: l.retweet_count || 0,
        // Same shape `twitter search` emits: a numeric string, '0' when X omits it.
        // Also feeds the log10(views) term of --top-by-engagement, which scored 0 before.
        views: tw.views?.count || '0',
        in_reply_to: l.in_reply_to_status_id_str || undefined,
        created_at: l.created_at,
        url: `https://x.com/${screenName}/status/${tw.rest_id}`,
        ...extractMedia(l),
        card: extractCard(tw),
        quoted_tweet: extractQuotedTweet(tw),
    };
}
function parseTweetDetail(data, seen) {
    const tweets = [];
    let nextCursor = null;
    const instructions = data?.data?.threaded_conversation_with_injections_v2?.instructions
        || data?.data?.tweetResult?.result?.timeline?.instructions
        || [];
    for (const inst of instructions) {
        for (const entry of inst.entries || []) {
            // Cursor entries
            const c = entry.content;
            if (c?.entryType === 'TimelineTimelineCursor' || c?.__typename === 'TimelineTimelineCursor') {
                if (/^(Bottom|ShowMore)/.test(c.cursorType || ''))
                    nextCursor = c.value;
                continue;
            }
            if (NEXT_CURSOR_ENTRY.test(entry.entryId || '')) {
                nextCursor = c?.itemContent?.value || c?.value || nextCursor;
                continue;
            }
            // Direct tweet entry
            const tw = extractTweet(c?.itemContent?.tweet_results?.result, seen);
            if (tw)
                tweets.push(tw);
            // Conversation module (nested replies)
            for (const item of c?.items || []) {
                const nested = extractTweet(item.item?.itemContent?.tweet_results?.result, seen);
                if (nested)
                    tweets.push(nested);
            }
        }
    }
    return { tweets, nextCursor };
}

export const __test__ = {
    parseTweetDetail,
};
// ── CLI definition ────────────────────────────────────────────────────
cli({
    site: 'twitter',
    name: 'thread',
    access: 'read',
    description: 'Get a tweet thread (original + all replies)',
    domain: 'x.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'tweet-id', positional: true, type: 'string', required: true, help: 'Tweet numeric ID (e.g. 1234567890) or full status URL' },
        { name: 'limit', type: 'int', default: 50 },
        { name: 'sort', type: 'string', default: 'relevance', choices: Object.keys(RANKING_MODES), help: 'Reply order X serves: relevance (default; reaches every reply, including the "probable spam" section) or recency (newest first; X stops it early on busy posts).' },
        { name: 'top-by-engagement', type: 'int', default: 0, help: 'When set to N>0, re-rank the thread by weighted engagement (likes×1 + retweets×3 + replies×2 + bookmarks×5 + log10(views+1)×0.5) and return the top N. Default 0 keeps the conversation\'s structural ordering.' },
    ],
    columns: ['id', 'author', 'author_avatar', 'bio', 'text', 'likes', 'retweets', 'views', 'url', 'has_media', 'media_urls', 'media_posters', 'media_durations', 'card', 'quoted_tweet', 'author_verified'],
    func: async (page, kwargs) => {
        let tweetId = kwargs['tweet-id'];
        const urlMatch = tweetId.match(/\/status\/(\d+)/);
        if (urlMatch)
            tweetId = urlMatch[1];
        // Cookie context auto-established by framework pre-nav (Strategy.COOKIE + domain).
        // Read CSRF token directly from the cookie store via CDP — zero page.evaluate round-trip.
        const cookies = await page.getCookies({ url: 'https://x.com' });
        const ct0 = cookies.find((c) => c.name === 'ct0')?.value || null;
        if (!ct0)
            throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');
        // Build auth headers in TypeScript
        const headers = JSON.stringify({
            'Authorization': `Bearer ${decodeURIComponent(TWITTER_BEARER_TOKEN)}`,
            'X-Csrf-Token': ct0,
            'X-Twitter-Auth-Type': 'OAuth2Session',
            'X-Twitter-Active-User': 'yes',
        });
        // Paginate — fetch in browser, parse in TypeScript
        const allTweets = [];
        const seen = new Set();
        const usedCursors = new Set();
        const rankingMode = RANKING_MODES[kwargs.sort] || RANKING_MODES.relevance;
        let cursor = null;
        let emptyPages = 0;
        for (let i = 0; i < MAX_PAGES && allTweets.length < kwargs.limit; i++) {
            const apiUrl = buildTweetDetailUrl(tweetId, cursor, rankingMode);
            // Browser-side: fetch + JSON parse with HTML-as-JSON sniffer so a
            // login wall / WAF page surfaces as a structured LoginWallError
            // instead of `SyntaxError: Unexpected token '<'`.
            const data = throwIfLoginWall(await page.evaluate(`async () => {
        ${BROWSER_JSON_SNIFF_FN}
        return await fetchJsonOrLoginWall("${apiUrl}", { headers: ${headers}, credentials: 'include' });
      }`), { url: apiUrl });
            if (data?.error) {
                if (allTweets.length === 0)
                    throw new CommandExecutionError(describeTwitterApiError('TweetDetail', data.error));
                break;
            }
            // TypeScript-side: type-safe parsing + cursor extraction
            const { tweets, nextCursor } = parseTweetDetail(data, seen);
            allTweets.push(...tweets);
            emptyPages = tweets.length ? 0 : emptyPages + 1;
            if (!nextCursor || usedCursors.has(nextCursor) || emptyPages >= EMPTY_PAGES_TO_END)
                break;
            usedCursors.add(nextCursor);
            cursor = nextCursor;
        }
        const trimmed = allTweets.slice(0, kwargs.limit);
        return applyTopByEngagement(trimmed, kwargs['top-by-engagement']);
    },
});
