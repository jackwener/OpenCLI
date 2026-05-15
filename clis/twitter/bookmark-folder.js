import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { TWITTER_BEARER_TOKEN, applyTopByEngagement } from './utils.js';
import { extractMedia, resolveTwitterQueryId } from './shared.js';

// Companion to bookmark-folders.js: reads tweets inside a single folder.
// X exposes folder contents through a separate timeline operation
// (BookmarkFolderTimeline). The shape is essentially the same as the
// global bookmarks timeline (bookmark_timeline_v2.timeline.instructions),
// just scoped to one folder via the bookmark_collection_id variable.
const OPERATION_NAME = 'BookmarkFolderTimeline';
const FALLBACK_QUERY_ID = '13H7EUATwethsj_jZ6QQAQ';
const FOLDER_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_PAGINATION_PAGES = 100;

const FEATURES = {
    rweb_video_screen_enabled: false,
    profile_label_improvements_pcf_label_in_post_enabled: true,
    responsive_web_profile_redirect_enabled: false,
    rweb_tipjar_consumption_enabled: false,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    premium_content_api_read_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    content_disclosure_indicator_enabled: true,
    content_disclosure_ai_generated_indicator_enabled: true,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: false,
    responsive_web_enhance_cards_enabled: false,
};

function buildFolderTimelineUrl(queryId, folderId, count, cursor) {
    const vars = {
        bookmark_collection_id: String(folderId),
        count,
        includePromotedContent: false,
    };
    if (cursor) vars.cursor = cursor;
    return `/i/api/graphql/${queryId}/${OPERATION_NAME}`
        + `?variables=${encodeURIComponent(JSON.stringify(vars))}`
        + `&features=${encodeURIComponent(JSON.stringify(FEATURES))}`;
}

export function extractFolderTweet(result, seen) {
    if (!result) return null;
    const tw = result.tweet || result;
    const legacy = tw.legacy || {};
    if (!tw.rest_id || seen.has(tw.rest_id)) return null;
    seen.add(tw.rest_id);
    const user = tw.core?.user_results?.result;
    const screenName = user?.legacy?.screen_name || user?.core?.screen_name || '';
    const noteText = tw.note_tweet?.note_tweet_results?.result?.text;
    return {
        id: tw.rest_id,
        author: screenName,
        text: noteText || legacy.full_text || '',
        likes: legacy.favorite_count || 0,
        retweets: legacy.retweet_count || 0,
        bookmarks: legacy.bookmark_count || 0,
        created_at: legacy.created_at || '',
        url: screenName ? `https://x.com/${screenName}/status/${tw.rest_id}` : `https://x.com/i/status/${tw.rest_id}`,
        ...extractMedia(legacy),
    };
}

/**
 * Parse the bookmark-folder timeline payload. Same instruction-walking
 * pattern as the global bookmarks timeline; X re-uses the
 * `bookmark_timeline_v2` envelope for folder-scoped queries.
 *
 * Exported via __test__.
 */
export function parseBookmarkFolderTimeline(data, seen) {
    const tweets = [];
    let nextCursor = null;
    const instructions = data?.data?.bookmark_collection_timeline?.timeline?.instructions
        || data?.data?.bookmark_timeline_v2?.timeline?.instructions
        || data?.data?.bookmark_timeline?.timeline?.instructions
        || [];
    for (const inst of instructions) {
        for (const entry of inst.entries || []) {
            const content = entry.content;
            if (content?.entryType === 'TimelineTimelineCursor' || content?.__typename === 'TimelineTimelineCursor') {
                if (content.cursorType === 'Bottom' || content.cursorType === 'ShowMore')
                    nextCursor = content.value;
                continue;
            }
            if (entry.entryId?.startsWith('cursor-bottom-') || entry.entryId?.startsWith('cursor-showMore-')) {
                nextCursor = content?.value || content?.itemContent?.value || nextCursor;
                continue;
            }
            const direct = extractFolderTweet(content?.itemContent?.tweet_results?.result, seen);
            if (direct) {
                tweets.push(direct);
                continue;
            }
            for (const item of content?.items || []) {
                const nested = extractFolderTweet(item.item?.itemContent?.tweet_results?.result, seen);
                if (nested) tweets.push(nested);
            }
        }
    }
    return { tweets, nextCursor };
}

cli({
    site: 'twitter',
    name: 'bookmark-folder',
    access: 'read',
    description: 'Read the tweets inside a single Twitter/X bookmark folder. Get the folder id from `opencli twitter bookmark-folders`.',
    domain: 'x.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'folder-id', positional: true, type: 'string', required: true, help: 'Folder id from `opencli twitter bookmark-folders`.' },
        { name: 'limit', type: 'int', default: 20, help: 'Maximum number of bookmarks to return (default 20).' },
        { name: 'top-by-engagement', type: 'int', default: 0, help: 'When set to N>0, re-rank the folder by weighted engagement (likes×1 + retweets×3 + replies×2 + bookmarks×5 + log10(views+1)×0.5) and return the top N. Default 0 keeps the API\'s native (saved-time) ordering.' },
    ],
    columns: ['id', 'author', 'text', 'likes', 'retweets', 'bookmarks', 'created_at', 'url', 'has_media', 'media_urls'],
    func: async (page, kwargs) => {
        const folderId = String(kwargs['folder-id'] || '').trim();
        if (!folderId || !FOLDER_ID_PATTERN.test(folderId)) {
            throw new ArgumentError(
                `Invalid folder-id: ${JSON.stringify(kwargs['folder-id'])}. Expected a safe folder ID from \`opencli twitter bookmark-folders\`.`,
            );
        }
        const limit = Number(kwargs.limit ?? 20);
        if (!Number.isInteger(limit) || limit < 1) {
            throw new ArgumentError(`Invalid --limit: ${JSON.stringify(kwargs.limit)}. Expected a positive integer.`);
        }

        const cookies = await page.getCookies({ url: 'https://x.com' });
        const ct0 = cookies.find((c) => c.name === 'ct0')?.value || null;
        if (!ct0)
            throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');

        const queryId = await resolveTwitterQueryId(page, OPERATION_NAME, FALLBACK_QUERY_ID);

        const headers = JSON.stringify({
            'Authorization': `Bearer ${decodeURIComponent(TWITTER_BEARER_TOKEN)}`,
            'X-Csrf-Token': ct0,
            'X-Twitter-Auth-Type': 'OAuth2Session',
            'X-Twitter-Active-User': 'yes',
        });

        const allTweets = [];
        const seen = new Set();
        let cursor = null;
        // Runaway guard only; --limit and cursor exhaustion control normal pagination.
        for (let i = 0; i < MAX_PAGINATION_PAGES && allTweets.length < limit; i++) {
            const fetchCount = Math.min(100, limit - allTweets.length + 10);
            const apiUrl = buildFolderTimelineUrl(queryId, folderId, fetchCount, cursor);
            const data = await page.evaluate(`async () => {
                const r = await fetch(${JSON.stringify(apiUrl)}, { headers: ${headers}, credentials: 'include' });
                return r.ok ? await r.json() : { error: r.status };
            }`);
            if (data?.error) {
                if (allTweets.length === 0)
                    throw new CommandExecutionError(`HTTP ${data.error}: Failed to fetch folder ${folderId}. queryId may have expired, or the folder may not exist.`);
                break;
            }
            const { tweets, nextCursor } = parseBookmarkFolderTimeline(data, seen);
            allTweets.push(...tweets);
            if (!nextCursor || nextCursor === cursor) break;
            cursor = nextCursor;
        }
        const trimmed = allTweets.slice(0, limit);
        return applyTopByEngagement(trimmed, kwargs['top-by-engagement']);
    },
});

export const __test__ = {
    parseBookmarkFolderTimeline,
    extractFolderTweet,
    buildFolderTimelineUrl,
    FOLDER_ID_PATTERN,
};
