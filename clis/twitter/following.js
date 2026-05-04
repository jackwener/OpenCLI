import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { resolveTwitterQueryId, sanitizeQueryId } from './shared.js';

const BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const FOLLOWING_QUERY_ID = 'zx6e-TLzRkeDO_a7p4b3JQ';  // Following fallback
const USER_BY_SCREEN_NAME_QUERY_ID = 'qRednkZG-rn1P6b48NINmQ';

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
    responsive_web_enhance_cards_enabled: false,
};

function buildFollowingUrl(queryId, userId, count, cursor) {
    const vars = {
        userId,
        count,
        includePromotedContent: false,
        withClientEventToken: false,
        withBirdwatchNotes: false,
        withVoice: true,
        withV2Timeline: true,
    };
    if (cursor)
        vars.cursor = cursor;
    return `/i/api/graphql/${queryId}/Following`
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

function extractUser(result) {
    if (!result || result.__typename !== 'User')
        return null;
    const core = result.core || {};
    const legacy = result.legacy || {};
    return {
        screen_name: core.screen_name || legacy.screen_name || 'unknown',
        name: core.name || legacy.name || 'unknown',
        bio: legacy.description || result.profile_bio?.description || '',
        followers: legacy.followers_count || legacy.normal_followers_count || 0,
    };
}

function parseFollowing(data) {
    const users = [];
    let nextCursor = null;
    const instructions = data?.data?.user?.result?.timeline_v2?.timeline?.instructions
        || data?.data?.user?.result?.timeline?.timeline?.instructions
        || [];
    for (const inst of instructions) {
        for (const entry of inst.entries || []) {
            const content = entry.content;
            // Extract cursor
            if (content?.entryType === 'TimelineTimelineCursor' || content?.__typename === 'TimelineTimelineCursor') {
                if (content.cursorType === 'Bottom' || content.cursorType === 'ShowMore')
                    nextCursor = content.value;
                continue;
            }
            if (entry.entryId?.startsWith('cursor-bottom-') || entry.entryId?.startsWith('cursor-showMore-')) {
                nextCursor = content?.value || content?.itemContent?.value || nextCursor;
                continue;
            }
            // Extract user
            if (entry.entryId?.startsWith('user-')) {
                const user = extractUser(content?.itemContent?.user_results?.result);
                if (user)
                    users.push(user);
            }
        }
    }
    return { users, nextCursor };
}

function normalizeScreenName(value) {
    return String(value || '').trim().replace(/^\/+/, '').replace(/^@+/, '');
}

cli({
    site: 'twitter',
    name: 'following',
    description: 'Get accounts a Twitter/X user is following',
    domain: 'x.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'user', positional: true, type: 'string', required: false },
        { name: 'limit', type: 'int', default: 50 },
    ],
    columns: ['screen_name', 'name', 'bio', 'followers'],
    func: async (page, kwargs) => {
        const limit = kwargs.limit === undefined || kwargs.limit === null ? 50 : Number(kwargs.limit);
        if (!Number.isInteger(limit) || limit <= 0) {
            throw new ArgumentError('twitter following --limit must be a positive integer', 'Example: opencli twitter following @elonmusk --limit 200');
        }
        let targetUser = normalizeScreenName(kwargs.user);

        await page.goto('https://x.com');
        await page.wait(3);

        const ct0 = await page.evaluate(`() => {
            return document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('ct0='))?.split('=')[1] || null;
        }`);
        if (!ct0)
            throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');

        if (!targetUser) {
            const href = await page.evaluate(`() => {
                const link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
                return link ? link.getAttribute('href') : null;
            }`);
            if (!href)
                throw new AuthRequiredError('x.com', 'Could not detect logged-in user. Are you logged in?');
            targetUser = normalizeScreenName(href.replace('/', ''));
        }
        if (!targetUser) {
            throw new ArgumentError('twitter following user cannot be empty', 'Example: opencli twitter following @elonmusk --limit 200');
        }

        const followingQueryId = await resolveTwitterQueryId(page, 'Following', FOLLOWING_QUERY_ID);
        const userByScreenNameQueryId = await resolveTwitterQueryId(page, 'UserByScreenName', USER_BY_SCREEN_NAME_QUERY_ID);
        const headers = JSON.stringify({
            'Authorization': `Bearer ${decodeURIComponent(BEARER_TOKEN)}`,
            'X-Csrf-Token': ct0,
            'X-Twitter-Auth-Type': 'OAuth2Session',
            'X-Twitter-Active-User': 'yes',
        });

        // Get userId from screen_name
        const userLookup = await page.evaluate(`async () => {
            const url = ${JSON.stringify(buildUserByScreenNameUrl(userByScreenNameQueryId, targetUser))};
            const resp = await fetch(url, { headers: ${headers}, credentials: 'include' });
            if (!resp.ok) return { error: resp.status };
            const d = await resp.json();
            return { userId: d.data?.user?.result?.rest_id || null };
        }`);
        if (userLookup?.error === 401 || userLookup?.error === 403) {
            throw new AuthRequiredError('x.com', `Twitter user lookup failed (HTTP ${userLookup.error})`);
        }
        if (userLookup?.error) {
            throw new CommandExecutionError(`HTTP ${userLookup.error}: Failed to resolve Twitter user @${targetUser}`);
        }
        const userId = userLookup?.userId || null;
        if (!userId)
            throw new CommandExecutionError(`Could not find user @${targetUser}`);

        const allUsers = [];
        const seen = new Set();
        let cursor = null;

        const maxPages = Math.ceil(limit / 50) + 2;
        for (let i = 0; i < maxPages && allUsers.length < limit; i++) {
            const fetchCount = Math.min(50, limit - allUsers.length + 10);
            const apiUrl = buildFollowingUrl(followingQueryId, userId, fetchCount, cursor);
            const data = await page.evaluate(`async () => {
                const r = await fetch("${apiUrl}", { headers: ${headers}, credentials: 'include' });
                return r.ok ? await r.json() : { error: r.status };
            }`);
            if (data?.error) {
                if (data.error === 401 || data.error === 403)
                    throw new AuthRequiredError('x.com', `Twitter following request failed (HTTP ${data.error})`);
                throw new CommandExecutionError(`HTTP ${data.error}: Failed to fetch following list. queryId may have expired.`);
            }
            const { users, nextCursor } = parseFollowing(data);
            for (const u of users) {
                if (!seen.has(u.screen_name)) {
                    seen.add(u.screen_name);
                    allUsers.push(u);
                }
            }
            if (!nextCursor || nextCursor === cursor)
                break;
            cursor = nextCursor;
        }

        if (allUsers.length === 0) {
            throw new EmptyResultError('twitter following', `No following accounts found for @${targetUser}`);
        }

        return allUsers.slice(0, limit);
    },
});

export const __test__ = {
    sanitizeQueryId,
    buildFollowingUrl,
    buildUserByScreenNameUrl,
    extractUser,
    normalizeScreenName,
    parseFollowing,
};
