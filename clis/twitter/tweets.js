import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { resolveTwitterOperationMetadata, sanitizeQueryId, extractMedia, normalizeTwitterGraphqlPayload, unwrapBrowserResult } from './shared.js';
import { normalizeTwitterScreenName } from './shared.js';
import { TWITTER_BEARER_TOKEN, applyTopByEngagement } from './utils.js';

const USER_TWEETS_QUERY_ID = 'lrMzG9qPQHpqJdP3AbM-bQ';
const USER_BY_SCREEN_NAME_QUERY_ID = 'IGgvgiOx4QZndDHuD3x9TQ';
const MAX_PAGINATION_PAGES = 100;

const USER_TWEETS_FEATURES = {
    rweb_video_screen_enabled: true,
    rweb_cashtags_enabled: true,
    payments_enabled: false,
    profile_label_improvements_pcf_label_in_post_enabled: true,
    responsive_web_profile_redirect_enabled: true,
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
    rweb_cashtags_composer_attachment_enabled: true,
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

const USER_TWEETS_FIELD_TOGGLES = {
    withPayments: true,
    withAuxiliaryUserLabels: true,
    withArticleRichContentState: true,
    withArticlePlainText: true,
    withArticleSummaryText: true,
    withArticleVoiceOver: true,
    withGrokAnalyze: true,
    withDisallowedReplyControls: true,
};

const USER_BY_SCREEN_NAME_FEATURES = {
    hidden_profile_subscriptions_enabled: true,
    profile_label_improvements_pcf_label_in_post_enabled: true,
    responsive_web_profile_redirect_enabled: true,
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

const USER_BY_SCREEN_NAME_FIELD_TOGGLES = {
    withPayments: true,
    withAuxiliaryUserLabels: true,
};

const USER_TWEETS_OPERATION = {
    queryId: USER_TWEETS_QUERY_ID,
    features: USER_TWEETS_FEATURES,
    fieldToggles: USER_TWEETS_FIELD_TOGGLES,
};

const USER_BY_SCREEN_NAME_OPERATION = {
    queryId: USER_BY_SCREEN_NAME_QUERY_ID,
    features: USER_BY_SCREEN_NAME_FEATURES,
    fieldToggles: USER_BY_SCREEN_NAME_FIELD_TOGGLES,
};

function normalizeUserTweetsOperation(operation) {
    if (typeof operation === 'string') {
        return { queryId: operation, features: USER_TWEETS_FEATURES, fieldToggles: USER_TWEETS_FIELD_TOGGLES };
    }
    return {
        queryId: operation?.queryId || USER_TWEETS_QUERY_ID,
        features: operation?.features || USER_TWEETS_FEATURES,
        fieldToggles: operation?.fieldToggles || USER_TWEETS_FIELD_TOGGLES,
    };
}

function normalizeUserByScreenNameOperation(operation) {
    if (typeof operation === 'string') {
        return { queryId: operation, features: USER_BY_SCREEN_NAME_FEATURES, fieldToggles: USER_BY_SCREEN_NAME_FIELD_TOGGLES };
    }
    return {
        queryId: operation?.queryId || USER_BY_SCREEN_NAME_QUERY_ID,
        features: operation?.features || USER_BY_SCREEN_NAME_FEATURES,
        fieldToggles: operation?.fieldToggles || USER_BY_SCREEN_NAME_FIELD_TOGGLES,
    };
}

function appendGraphqlParams(path, variables, operation) {
    const fieldToggles = operation.fieldToggles || {};
    const params = [
        `variables=${encodeURIComponent(JSON.stringify(variables))}`,
        `features=${encodeURIComponent(JSON.stringify(operation.features || {}))}`,
    ];
    if (Object.keys(fieldToggles).length > 0) {
        params.push(`fieldToggles=${encodeURIComponent(JSON.stringify(fieldToggles))}`);
    }
    return `${path}?${params.join('&')}`;
}

function buildUserTweetsUrl(operation, userId, count, cursor) {
    const normalized = normalizeUserTweetsOperation(operation);
    const vars = {
        userId,
        count,
        includePromotedContent: false,
        withQuickPromoteEligibilityTweetFields: true,
        withVoice: true,
    };
    if (cursor) vars.cursor = cursor;
    return appendGraphqlParams(`/i/api/graphql/${normalized.queryId}/UserTweets`, vars, normalized);
}

function buildUserByScreenNameUrl(operation, screenName) {
    const normalized = normalizeUserByScreenNameOperation(operation);
    const vars = { screen_name: screenName, withSafetyModeUserFields: true };
    return appendGraphqlParams(`/i/api/graphql/${normalized.queryId}/UserByScreenName`, vars, normalized);
}

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
        { name: 'limit', type: 'int', default: 20, help: 'Max tweets to return' },
        { name: 'top-by-engagement', type: 'int', default: 0, help: 'When set to N>0, re-rank the tweets by weighted engagement (likes×1 + retweets×3 + replies×2 + bookmarks×5 + log10(views+1)×0.5) and return the top N. Default 0 keeps the chronological ordering.' },
    ],
    columns: ['id', 'author', 'created_at', 'is_retweet', 'text', 'likes', 'retweets', 'replies', 'views', 'url', 'has_media', 'media_urls'],
    func: async (page, kwargs) => {
        const limit = Math.max(1, Math.min(200, kwargs.limit || 20));
        const rawUsername = String(kwargs.username ?? '').trim();
        let username = normalizeTwitterScreenName(rawUsername);
        if (rawUsername && !username) {
            throw new ArgumentError('twitter tweets username must be a valid Twitter/X handle', 'Example: opencli twitter tweets @jack --limit 20');
        }
        // When no username is given, detect the logged-in user (own tweets).
        // Mirrors the self-detection pattern used by twitter/profile and
        // twitter/likes so agents can pull own-account data without having
        // to know their own screen name up front.
        if (!username) {
            await page.goto('https://x.com/home');
            await page.wait({ selector: '[data-testid="primaryColumn"]' });
            // Bridge wraps primitive page.evaluate returns as { session, data:<value> }.
            // unwrapBrowserResult drops that envelope so the href string is usable.
            const href = unwrapBrowserResult(await page.evaluate(`() => {
        const link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
        return link ? link.getAttribute('href') : null;
      }`));
            if (!href || typeof href !== 'string')
                throw new AuthRequiredError('x.com', 'Could not detect logged-in user. Are you logged in?');
            username = normalizeTwitterScreenName(href);
            if (!username) {
                throw new AuthRequiredError('x.com', 'Could not detect logged-in user. Are you logged in?');
            }
        }

        const cookies = await page.getCookies({ url: 'https://x.com' });
        const ct0 = cookies.find((c) => c.name === 'ct0')?.value || null;
        if (!ct0) throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');

        const userTweetsOperation = await resolveTwitterOperationMetadata(page, 'UserTweets', USER_TWEETS_OPERATION);
        const userByScreenNameOperation = await resolveTwitterOperationMetadata(page, 'UserByScreenName', USER_BY_SCREEN_NAME_OPERATION);

        const headers = JSON.stringify({
            'Authorization': `Bearer ${decodeURIComponent(TWITTER_BEARER_TOKEN)}`,
            'X-Csrf-Token': ct0,
            'X-Twitter-Auth-Type': 'OAuth2Session',
            'X-Twitter-Active-User': 'yes',
        });

        const ubsUrl = buildUserByScreenNameUrl(userByScreenNameOperation, username);
        const userId = unwrapBrowserResult(await page.evaluate(`async () => {
      const resp = await fetch("${ubsUrl}", { headers: ${headers}, credentials: 'include' });
      if (!resp.ok) return null;
      const d = await resp.json();
      return d?.data?.user?.result?.rest_id || null;
    }`));
        if (!userId) throw new CommandExecutionError(`Could not resolve @${username}`);

        const seen = new Set();
        const all = [];
        let cursor = null;
        // Runaway guard only; --limit and cursor exhaustion control normal pagination.
        for (let i = 0; i < MAX_PAGINATION_PAGES && all.length < limit; i++) {
            const fetchCount = Math.min(100, limit - all.length + 10);
            const url = buildUserTweetsUrl(userTweetsOperation, userId, fetchCount, cursor);
            const data = normalizeTwitterGraphqlPayload(await page.evaluate(`async () => {
        const r = await fetch("${url}", { headers: ${headers}, credentials: 'include' });
        return r.ok ? await r.json() : { error: r.status };
      }`));
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
        const trimmed = all.slice(0, limit);
        return applyTopByEngagement(trimmed, kwargs['top-by-engagement']);
    },
});

export const __test__ = {
    sanitizeQueryId,
    buildUserTweetsUrl,
    buildUserByScreenNameUrl,
    extractTweet,
    parseUserTweets,
};
