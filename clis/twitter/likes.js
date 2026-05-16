import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { normalizeTwitterScreenName, resolveTwitterQueryId, sanitizeQueryId, extractMedia, unwrapBrowserResult } from './shared.js';
import { TWITTER_BEARER_TOKEN, applyTopByEngagement } from './utils.js';
const LIKES_QUERY_ID = 'RozQdCp4CilQzrcuU0NY5w';
const USER_BY_SCREEN_NAME_QUERY_ID = 'qRednkZG-rn1P6b48NINmQ';
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
    responsive_web_grok_analyze_button_fetch_trends_enabled: false,
    responsive_web_grok_analyze_post_followups_enabled: true,
    responsive_web_jetfuel_frame: true,
    responsive_web_grok_share_attachment_enabled: true,
    responsive_web_grok_annotations_enabled: true,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    content_disclosure_indicator_enabled: true,
    content_disclosure_ai_generated_indicator_enabled: true,
    responsive_web_grok_show_grok_translated_post: false,
    responsive_web_grok_analysis_button_from_backend: true,
    post_ctas_fetch_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: false,
    responsive_web_grok_image_annotation_enabled: true,
    responsive_web_grok_imagine_annotation_enabled: true,
    responsive_web_grok_community_note_auto_translation_is_enabled: false,
    responsive_web_enhance_cards_enabled: false
};
function buildLikesUrl(queryId, userId, count, cursor) {
    const vars = {
        userId,
        count,
        includePromotedContent: false,
        withClientEventToken: false,
        withBirdwatchNotes: false,
        withVoice: true
    };
    if (cursor)
        vars.cursor = cursor;
    return `/i/api/graphql/${queryId}/Likes`
        + `?variables=${encodeURIComponent(JSON.stringify(vars))}`
        + `&features=${encodeURIComponent(JSON.stringify(FEATURES))}`;
}
function buildUserByScreenNameUrl(queryId, screenName) {
    const vars = JSON.stringify({ screen_name: screenName, withSafetyModeUserFields: true });
    const feats = JSON.stringify({
        hidden_profile_subscriptions_enabled: true,
        rweb_tipjar_consumption_enabled: true,
        responsive_web_graphql_exclude_directive_enabled: true,
        verified_phone_label_enabled: false,
        subscriptions_verification_info_is_identity_verified_enabled: true,
        subscriptions_verification_info_verified_since_enabled: true,
        highlights_tweets_tab_ui_enabled: true,
        responsive_web_twitter_article_notes_tab_enabled: true,
        subscriptions_feature_can_gift_premium: true,
        creator_subscriptions_tweet_preview_api_enabled: true,
        responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
        responsive_web_graphql_timeline_navigation_enabled: true,
    });
    return `/i/api/graphql/${queryId}/UserByScreenName`
        + `?variables=${encodeURIComponent(vars)}`
        + `&features=${encodeURIComponent(feats)}`;
}
function extractLikedTweet(result, seen) {
    if (!result)
        return null;
    const tw = result.tweet || result;
    const legacy = tw.legacy || {};
    if (!tw.rest_id || seen.has(tw.rest_id))
        return null;
    seen.add(tw.rest_id);
    const user = tw.core?.user_results?.result;
    const screenName = user?.legacy?.screen_name || user?.core?.screen_name || 'unknown';
    const displayName = user?.legacy?.name || user?.core?.name || '';
    const noteText = tw.note_tweet?.note_tweet_results?.result?.text;
    return {
        id: tw.rest_id,
        author: screenName,
        name: displayName,
        text: noteText || legacy.full_text || '',
        likes: legacy.favorite_count || 0,
        retweets: legacy.retweet_count || 0,
        created_at: legacy.created_at || '',
        url: `https://x.com/${screenName}/status/${tw.rest_id}`,
        ...extractMedia(legacy),
    };
}
function parseLikes(data, seen) {
    const tweets = [];
    let nextCursor = null;
    const instructions = data?.data?.user?.result?.timeline_v2?.timeline?.instructions
        || data?.data?.user?.result?.timeline?.timeline?.instructions
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
            const direct = extractLikedTweet(content?.itemContent?.tweet_results?.result, seen);
            if (direct) {
                tweets.push(direct);
                continue;
            }
            for (const item of content?.items || []) {
                const nested = extractLikedTweet(item.item?.itemContent?.tweet_results?.result, seen);
                if (nested)
                    tweets.push(nested);
            }
        }
    }
    return { tweets, nextCursor };
}
cli({
    site: 'twitter',
    name: 'likes',
    access: 'read',
    description: 'Fetch liked tweets of a Twitter user (defaults to the logged-in user when no username is given)',
    domain: 'x.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'username', type: 'string', positional: true, help: 'Twitter screen name (with or without @). Defaults to the logged-in user when omitted.' },
        { name: 'limit', type: 'int', default: 20, help: 'Maximum number of liked tweets to return (default 20).' },
        { name: 'top-by-engagement', type: 'int', default: 0, help: 'When set to N>0, re-rank the liked tweets by weighted engagement (likes×1 + retweets×3 + replies×2 + bookmarks×5 + log10(views+1)×0.5) and return the top N. Default 0 keeps the API\'s native (recency) ordering.' },
    ],
    columns: ['id', 'author', 'name', 'text', 'likes', 'retweets', 'created_at', 'url', 'has_media', 'media_urls'],
    func: async (page, kwargs) => {
        const limit = kwargs.limit || 20;
        const rawUsername = String(kwargs.username ?? '').trim();
        let username = normalizeTwitterScreenName(rawUsername);
        if (rawUsername && !username) {
            throw new ArgumentError('twitter likes username must be a valid Twitter/X handle', 'Example: opencli twitter likes @jack --limit 20');
        }
        const cookies = await page.getCookies({ url: 'https://x.com' });
        const ct0 = cookies.find((c) => c.name === 'ct0')?.value || null;
        if (!ct0)
            throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');
        // If no username provided, detect the logged-in user.
        // Bridge wraps primitive page.evaluate returns as { session, data:<value> };
        // unwrap so the href string is usable downstream.
        if (!username) {
            // Force a navigation to the home surface so the AppTabBar sidebar
            // is rendered; the framework pre-nav lands on bare x.com which
            // does not always expose AppTabBar_Profile_Link.
            await page.goto('https://x.com/home');
            await page.wait({ selector: '[data-testid="primaryColumn"]' });
            const href = unwrapBrowserResult(await page.evaluate(`() => {
        const link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
        return link ? link.getAttribute('href') : null;
      }`));
            if (!href || typeof href !== 'string')
                throw new AuthRequiredError('x.com', 'Could not detect logged-in user. Are you logged in?');
            username = normalizeTwitterScreenName(href);
            if (!username)
                throw new AuthRequiredError('x.com', 'Could not detect logged-in user. Are you logged in?');
        }
        const likesQueryId = await resolveTwitterQueryId(page, 'Likes', LIKES_QUERY_ID);
        const userByScreenNameQueryId = await resolveTwitterQueryId(page, 'UserByScreenName', USER_BY_SCREEN_NAME_QUERY_ID);
        const headers = JSON.stringify({
            'Authorization': `Bearer ${decodeURIComponent(TWITTER_BEARER_TOKEN)}`,
            'X-Csrf-Token': ct0,
            'X-Twitter-Auth-Type': 'OAuth2Session',
            'X-Twitter-Active-User': 'yes',
        });
        // Get userId from screen_name
        const userId = unwrapBrowserResult(await page.evaluate(`async () => {
      const screenName = ${JSON.stringify(username)};
      const url = ${JSON.stringify(buildUserByScreenNameUrl(userByScreenNameQueryId, username))};
      const resp = await fetch(url, { headers: ${headers}, credentials: 'include' });
      if (!resp.ok) return null;
      const d = await resp.json();
      return d.data?.user?.result?.rest_id || null;
    }`));
        if (!userId) {
            throw new CommandExecutionError(`Could not find user @${username}`);
        }
        const allTweets = [];
        const seen = new Set();
        let cursor = null;
        // Runaway guard only; --limit and cursor exhaustion control normal pagination.
        for (let i = 0; i < MAX_PAGINATION_PAGES && allTweets.length < limit; i++) {
            const fetchCount = Math.min(100, limit - allTweets.length + 10);
            const apiUrl = buildLikesUrl(likesQueryId, userId, fetchCount, cursor);
            const data = unwrapBrowserResult(await page.evaluate(`async () => {
        const r = await fetch("${apiUrl}", { headers: ${headers}, credentials: 'include' });
        return r.ok ? await r.json() : { error: r.status };
      }`));
            if (data?.error) {
                if (allTweets.length === 0)
                    throw new CommandExecutionError(`HTTP ${data.error}: Failed to fetch likes. queryId may have expired.`);
                break;
            }
            const { tweets, nextCursor } = parseLikes(data, seen);
            allTweets.push(...tweets);
            if (!nextCursor || nextCursor === cursor)
                break;
            cursor = nextCursor;
        }
        const trimmed = allTweets.slice(0, limit);
        return applyTopByEngagement(trimmed, kwargs['top-by-engagement']);
    },
});
export const __test__ = {
    sanitizeQueryId,
    buildLikesUrl,
    buildUserByScreenNameUrl,
    parseLikes,
};
