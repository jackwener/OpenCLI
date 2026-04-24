import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { resolveTwitterQueryId, sanitizeQueryId, extractMedia } from './shared.js';

const BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const USER_TWEETS_QUERY_ID = '6fWQaBPK51aGyC_VC7t9GQ';
const USER_BY_SCREEN_NAME_QUERY_ID = 'IGgvgiOx4QZndDHuD3x9TQ';

const USER_TWEETS_FEATURES = {
    rweb_video_screen_enabled: false,
    payments_enabled: false,
    profile_label_improvements_pcf_label_in_post_enabled: true,
    rweb_tipjar_consumption_enabled: true,
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
    longform_notetweets_inline_media_enabled: true,
    responsive_web_grok_image_annotation_enabled: true,
    responsive_web_grok_imagine_annotation_enabled: true,
    responsive_web_grok_community_note_auto_translation_is_enabled: false,
    responsive_web_enhance_cards_enabled: false,
};

const USER_BY_SCREEN_NAME_FEATURES = {
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
};

function buildUserTweetsUrl(queryId, userId, count, cursor) {
    const vars = {
        userId,
        count,
        includePromotedContent: false,
        withQuickPromoteEligibilityTweetFields: true,
        withVoice: true,
    };
    if (cursor) vars.cursor = cursor;
    return `/i/api/graphql/${queryId}/UserTweets`
        + `?variables=${encodeURIComponent(JSON.stringify(vars))}`
        + `&features=${encodeURIComponent(JSON.stringify(USER_TWEETS_FEATURES))}`;
}

function buildUserByScreenNameUrl(queryId, screenName) {
    const vars = { screen_name: screenName, withSafetyModeUserFields: true };
    return `/i/api/graphql/${queryId}/UserByScreenName`
        + `?variables=${encodeURIComponent(JSON.stringify(vars))}`
        + `&features=${encodeURIComponent(JSON.stringify(USER_BY_SCREEN_NAME_FEATURES))}`;
}

function extractTweet(result, seen) {
    if (!result) return null;
    const tw = result.tweet || result;
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
    };
}

function parseUserTweets(data, seen) {
    const tweets = [];
    let nextCursor = null;
    const instructions = data?.data?.user?.result?.timeline_v2?.timeline?.instructions
        || data?.data?.user?.result?.timeline?.timeline?.instructions
        || [];
    for (const inst of instructions) {
        if (inst.type === 'TimelinePinEntry') continue;
        for (const entry of inst.entries || []) {
            const content = entry.content;
            if (content?.entryType === 'TimelineTimelineCursor' || content?.__typename === 'TimelineTimelineCursor') {
                if (content.cursorType === 'Bottom' || content.cursorType === 'ShowMore') nextCursor = content.value;
                continue;
            }
            if (entry.entryId?.startsWith('cursor-bottom-') || entry.entryId?.startsWith('cursor-showMore-')) {
                nextCursor = content?.value || content?.itemContent?.value || nextCursor;
                continue;
            }
            const direct = extractTweet(content?.itemContent?.tweet_results?.result, seen);
            if (direct) {
                tweets.push(direct);
                continue;
            }
            for (const item of content?.items || []) {
                const nested = extractTweet(item.item?.itemContent?.tweet_results?.result, seen);
                if (nested) tweets.push(nested);
            }
        }
    }
    return { tweets, nextCursor };
}

cli({
    site: 'twitter',
    name: 'tweets',
    description: "Fetch a Twitter user's most recent tweets (chronological, excludes pinned)",
    domain: 'x.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'username', type: 'string', positional: true, required: true, help: 'Twitter screen name (with or without @)' },
        { name: 'limit', type: 'int', default: 20, help: 'Max tweets to return' },
    ],
    columns: ['author', 'created_at', 'is_retweet', 'text', 'likes', 'retweets', 'replies', 'views', 'url', 'has_media', 'media_urls'],
    func: async (page, kwargs) => {
        const limit = Math.max(1, Math.min(200, kwargs.limit || 20));
        const username = String(kwargs.username || '').replace(/^@/, '').trim();
        if (!username) throw new CommandExecutionError('username is required');

        await page.goto('https://x.com');
        await page.wait(3);

        const ct0 = await page.evaluate(`() => {
      return document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('ct0='))?.split('=')[1] || null;
    }`);
        if (!ct0) throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');

        const userTweetsQueryId = await resolveTwitterQueryId(page, 'UserTweets', USER_TWEETS_QUERY_ID);
        const userByScreenNameQueryId = await resolveTwitterQueryId(page, 'UserByScreenName', USER_BY_SCREEN_NAME_QUERY_ID);

        const headers = JSON.stringify({
            'Authorization': `Bearer ${decodeURIComponent(BEARER_TOKEN)}`,
            'X-Csrf-Token': ct0,
            'X-Twitter-Auth-Type': 'OAuth2Session',
            'X-Twitter-Active-User': 'yes',
        });

        const ubsUrl = buildUserByScreenNameUrl(userByScreenNameQueryId, username);
        const userId = await page.evaluate(`async () => {
      const resp = await fetch("${ubsUrl}", { headers: ${headers}, credentials: 'include' });
      if (!resp.ok) return null;
      const d = await resp.json();
      return d?.data?.user?.result?.rest_id || null;
    }`);
        if (!userId) throw new CommandExecutionError(`Could not resolve @${username}`);

        const seen = new Set();
        const all = [];
        let cursor = null;
        for (let i = 0; i < 5 && all.length < limit; i++) {
            const fetchCount = Math.min(100, limit - all.length + 10);
            const url = buildUserTweetsUrl(userTweetsQueryId, userId, fetchCount, cursor);
            const data = await page.evaluate(`async () => {
        const r = await fetch("${url}", { headers: ${headers}, credentials: 'include' });
        return r.ok ? await r.json() : { error: r.status };
      }`);
            if (data?.error) {
                if (all.length === 0) throw new CommandExecutionError(`HTTP ${data.error}: UserTweets fetch failed — queryId may have expired`);
                break;
            }
            const { tweets, nextCursor } = parseUserTweets(data, seen);
            all.push(...tweets);
            if (!nextCursor || nextCursor === cursor) break;
            cursor = nextCursor;
        }

        if (all.length === 0) throw new EmptyResultError(`@${username} has no recent tweets`, 'Account may be private or suspended');
        return all.slice(0, limit);
    },
});

export const __test__ = {
    sanitizeQueryId,
    buildUserTweetsUrl,
    buildUserByScreenNameUrl,
    extractTweet,
    parseUserTweets,
};
