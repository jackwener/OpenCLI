import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { resolveTwitterOperationMetadata, normalizeTwitterGraphqlPayload, unwrapBrowserResult, normalizeTwitterScreenName } from './shared.js';
import { TWITTER_BEARER_TOKEN } from './utils.js';

const USER_TWEETS_QUERY_ID = 'lrMzG9qPQHpqJdP3AbM-bQ';
const USER_BY_SCREEN_NAME_QUERY_ID = 'IGgvgiOx4QZndDHuD3x9TQ';

export const MAX_USER_TWEETS_PAGES = 100;
export const USER_TWEETS_PAGE_SIZE = 100;
export const MAX_USER_TWEETS_LIMIT = MAX_USER_TWEETS_PAGES * USER_TWEETS_PAGE_SIZE;
export const DEFAULT_USER_TWEETS_PAGE_DELAY_SECONDS = 2;

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

export function buildUserTweetsUrl(operation, userId, count, cursor) {
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

export function buildUserByScreenNameUrl(operation, screenName) {
    const normalized = normalizeUserByScreenNameOperation(operation);
    const vars = { screen_name: screenName, withSafetyModeUserFields: true };
    return appendGraphqlParams(`/i/api/graphql/${normalized.queryId}/UserByScreenName`, vars, normalized);
}

export async function resolveUserTimelineContext(page, rawUsername, { allowLoggedInDefault = false } = {}) {
    const raw = String(rawUsername ?? '').trim();
    let username = normalizeTwitterScreenName(raw);
    if (raw && !username) {
        throw new ArgumentError('twitter tweets username must be a valid Twitter/X handle', 'Example: opencli twitter tweets @jack --limit 20');
    }
    if (!username && !allowLoggedInDefault) {
        throw new ArgumentError('twitter collection username must be a valid Twitter/X handle', 'Example: opencli twitter collection @jack --until 2026-07-23T00:00:00Z');
    }
    if (!username) {
        await page.goto('https://x.com/home');
        await page.wait({ selector: '[data-testid="primaryColumn"]' });
        const href = unwrapBrowserResult(await page.evaluate(`() => {
            const link = document.querySelector('a[data-testid="AppTabBar_Profile_Link"]');
            return link ? link.getAttribute('href') : null;
        }`));
        if (!href || typeof href !== 'string') {
            throw new AuthRequiredError('x.com', 'Could not detect logged-in user. Are you logged in?');
        }
        username = normalizeTwitterScreenName(href);
        if (!username) {
            throw new AuthRequiredError('x.com', 'Could not detect logged-in user. Are you logged in?');
        }
    }

    const cookies = await page.getCookies({ url: 'https://x.com' });
    const ct0 = cookies.find((cookie) => cookie.name === 'ct0')?.value || null;
    if (!ct0) throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');

    const userTweetsOperation = await resolveTwitterOperationMetadata(page, 'UserTweets', USER_TWEETS_OPERATION);
    const userByScreenNameOperation = await resolveTwitterOperationMetadata(page, 'UserByScreenName', USER_BY_SCREEN_NAME_OPERATION);
    const headers = JSON.stringify({
        Authorization: `Bearer ${decodeURIComponent(TWITTER_BEARER_TOKEN)}`,
        'X-Csrf-Token': ct0,
        'X-Twitter-Auth-Type': 'OAuth2Session',
        'X-Twitter-Active-User': 'yes',
    });
    const userByScreenNameUrl = buildUserByScreenNameUrl(userByScreenNameOperation, username);
    const userId = unwrapBrowserResult(await page.evaluate(`async () => {
        const resp = await fetch(${JSON.stringify(userByScreenNameUrl)}, { headers: ${headers}, credentials: 'include' });
        if (!resp.ok) return null;
        const data = await resp.json();
        return data?.data?.user?.result?.rest_id || null;
    }`));
    if (!userId) throw new CommandExecutionError(`Could not resolve @${username}`);
    return { username, userId, headers, userTweetsOperation };
}

export async function fetchUserTimelinePage(page, context, cursor, count) {
    const url = buildUserTweetsUrl(context.userTweetsOperation, context.userId, count, cursor);
    return normalizeTwitterGraphqlPayload(await page.evaluate(`async () => {
        const response = await fetch(${JSON.stringify(url)}, { headers: ${context.headers}, credentials: 'include' });
        return response.ok ? await response.json() : { error: response.status };
    }`));
}
