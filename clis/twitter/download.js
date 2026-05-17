/**
 * Twitter/X download — download images and videos from tweets.
 *
 * Profile media path uses the same GraphQL UserMedia endpoint the
 * native client uses with cursor-based pagination, so it bypasses the
 * virtual-scroll DOM cap that limited the previous scraper to ~visible
 * tiles (see #1612).
 *
 * Usage:
 *   opencli twitter download elonmusk --limit 50 --output ./twitter
 *   opencli twitter download --tweet-url https://x.com/xxx/status/123 --output ./twitter
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { formatCookieHeader } from '@jackwener/opencli/download';
import { downloadMedia } from '@jackwener/opencli/download/media-download';
import {
    resolveTwitterOperationMetadata,
    normalizeTwitterGraphqlPayload,
    unwrapBrowserResult,
    normalizeTwitterScreenName,
    extractMedia,
} from './shared.js';
import { TWITTER_BEARER_TOKEN } from './utils.js';

const USER_MEDIA_QUERY_ID = '9EovraBTXJYGSEQXZqlLmQ';
const USER_BY_SCREEN_NAME_QUERY_ID = 'IGgvgiOx4QZndDHuD3x9TQ';
const MAX_PAGINATION_PAGES = 100;

const USER_MEDIA_FEATURES = {
    rweb_video_screen_enabled: true,
    rweb_cashtags_enabled: true,
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
    rweb_conversational_replies_downvote_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
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

const USER_MEDIA_FIELD_TOGGLES = {
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

const USER_MEDIA_OPERATION = {
    queryId: USER_MEDIA_QUERY_ID,
    features: USER_MEDIA_FEATURES,
    fieldToggles: USER_MEDIA_FIELD_TOGGLES,
};

const USER_BY_SCREEN_NAME_OPERATION = {
    queryId: USER_BY_SCREEN_NAME_QUERY_ID,
    features: USER_BY_SCREEN_NAME_FEATURES,
    fieldToggles: USER_BY_SCREEN_NAME_FIELD_TOGGLES,
};

function normalizeUserMediaOperation(operation) {
    if (typeof operation === 'string') {
        return { queryId: operation, features: USER_MEDIA_FEATURES, fieldToggles: USER_MEDIA_FIELD_TOGGLES };
    }
    return {
        queryId: operation?.queryId || USER_MEDIA_QUERY_ID,
        features: operation?.features || USER_MEDIA_FEATURES,
        fieldToggles: operation?.fieldToggles || USER_MEDIA_FIELD_TOGGLES,
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

function buildUserMediaUrl(operation, userId, count, cursor) {
    const normalized = normalizeUserMediaOperation(operation);
    const vars = {
        userId,
        count,
        includePromotedContent: false,
        withClientEventToken: false,
        withBirdwatchNotes: false,
        withVoice: true,
    };
    if (cursor) vars.cursor = cursor;
    return appendGraphqlParams(`/i/api/graphql/${normalized.queryId}/UserMedia`, vars, normalized);
}

function buildUserByScreenNameUrl(operation, screenName) {
    const normalized = normalizeUserByScreenNameOperation(operation);
    const vars = { screen_name: screenName, withSafetyModeUserFields: true };
    return appendGraphqlParams(`/i/api/graphql/${normalized.queryId}/UserByScreenName`, vars, normalized);
}

function classifyMediaUrl(url) {
    if (!url) return 'unknown';
    if (/video\.twimg\.com|\.mp4(\?|$)|\.m3u8(\?|$)/.test(url)) return 'video';
    return 'image';
}

function parseUserMedia(data, seen) {
    const items = [];
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
            const raw = value.tweet_results.result;
            const tw = raw.__typename === 'TweetWithVisibilityResults' && raw.tweet
                ? raw.tweet
                : (raw.tweet || raw);
            if (tw.rest_id && !seen.has(tw.rest_id)) {
                seen.add(tw.rest_id);
                const { media_urls } = extractMedia(tw.legacy || {});
                for (const url of media_urls) {
                    items.push({ tweet_id: tw.rest_id, url, type: classifyMediaUrl(url) });
                }
            }
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
    return { items, nextCursor };
}

cli({
    site: 'twitter',
    name: 'download',
    access: 'read',
    description: 'Download Twitter/X media (images and videos). Provide either <username> to fetch every media item from their profile via the GraphQL UserMedia endpoint with cursor pagination, or --tweet-url to download a single tweet.',
    domain: 'x.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'username', positional: true, help: 'Twitter username (with or without @) to scan their profile media. Either <username> or --tweet-url is required.' },
        { name: 'tweet-url', help: 'Single tweet URL to download. Use this OR <username>, not both required at once.' },
        { name: 'limit', type: 'int', default: 10, help: 'Maximum number of media items to download when scanning a profile (default 10). Ignored when --tweet-url is used.' },
        { name: 'output', default: './twitter-downloads', help: 'Output directory (default ./twitter-downloads). A per-source subdir is created inside.' },
    ],
    columns: ['index', 'type', 'status', 'size'],
    func: async (page, kwargs) => {
        const rawUsername = String(kwargs.username ?? '').trim();
        const tweetUrl = kwargs['tweet-url'];
        const limit = Math.max(1, kwargs.limit || 10);
        const output = kwargs.output;
        if (!rawUsername && !tweetUrl) {
            throw new ArgumentError('twitter download requires either <username> or --tweet-url');
        }
        if (tweetUrl) {
            return downloadSingleTweet(page, tweetUrl, output);
        }
        const username = normalizeTwitterScreenName(rawUsername);
        if (!username) {
            throw new ArgumentError('twitter download username must be a valid Twitter/X handle', 'Example: opencli twitter download @jack --limit 20');
        }
        return downloadUserMedia(page, username, limit, output);
    },
});

async function downloadUserMedia(page, username, limit, output) {
    await page.goto(`https://x.com/${username}`);
    await page.wait({ selector: '[data-testid="primaryColumn"]' });

    const cookies = await page.getCookies({ url: 'https://x.com' });
    const ct0 = cookies.find((c) => c.name === 'ct0')?.value || null;
    if (!ct0) throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');

    const userMediaOperation = await resolveTwitterOperationMetadata(page, 'UserMedia', USER_MEDIA_OPERATION);
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
    for (let i = 0; i < MAX_PAGINATION_PAGES && all.length < limit; i++) {
        const fetchCount = Math.min(100, limit - all.length + 10);
        const url = buildUserMediaUrl(userMediaOperation, userId, fetchCount, cursor);
        const data = normalizeTwitterGraphqlPayload(await page.evaluate(`async () => {
        const r = await fetch("${url}", { headers: ${headers}, credentials: 'include' });
        return r.ok ? await r.json() : { error: r.status };
      }`));
        if (data?.error) {
            if (all.length === 0) throw new CommandExecutionError(`HTTP ${data.error}: UserMedia fetch failed — queryId may have expired`);
            break;
        }
        const { items, nextCursor } = parseUserMedia(data, seen);
        all.push(...items);
        if (!nextCursor || nextCursor === cursor) break;
        cursor = nextCursor;
    }

    if (all.length === 0) throw new EmptyResultError(`@${username} has no media`, 'Account may be private, suspended, or have no media posts');

    const trimmed = all.slice(0, limit);
    return downloadMedia(trimmed, {
        output,
        subdir: username,
        cookies: formatCookieHeader(cookies),
        browserCookies: cookies,
        filenamePrefix: username,
        ytdlpExtraArgs: ['--merge-output-format', 'mp4'],
    });
}

async function downloadSingleTweet(page, tweetUrl, output) {
    await page.goto(tweetUrl);
    await page.wait(3);
    const items = unwrapBrowserResult(await page.evaluate(`
      (() => {
        const out = [];
        document.querySelectorAll('img[src*="pbs.twimg.com/media"]').forEach(img => {
          let src = img.src || '';
          src = src.replace(/&name=\\w+$/, '&name=large');
          if (!src.includes('&name=')) src = src + '&name=large';
          out.push({ type: 'image', url: src });
        });
        document.querySelectorAll('video').forEach(video => {
          const src = video.src || '';
          if (src) out.push({ type: 'video', url: src, poster: video.poster || '' });
        });
        document.querySelectorAll('[data-testid="videoPlayer"]').forEach(player => {
          const tweetLink = player.closest('article')?.querySelector('a[href*="/status/"]');
          const href = tweetLink?.getAttribute('href') || '';
          if (href) out.push({ type: 'video-tweet', url: 'https://x.com' + href });
        });
        return out;
      })()
    `));
    if (!items || items.length === 0) {
        return [{ index: 0, type: '-', status: 'failed', size: 'No media found' }];
    }
    const cookies = await page.getCookies({ domain: 'x.com' });
    const seen = new Set();
    const unique = items.filter((m) => {
        if (seen.has(m.url)) return false;
        seen.add(m.url);
        return true;
    });
    return downloadMedia(unique, {
        output,
        subdir: 'tweets',
        cookies: formatCookieHeader(cookies),
        browserCookies: cookies,
        filenamePrefix: 'tweet',
        ytdlpExtraArgs: ['--merge-output-format', 'mp4'],
    });
}

export const __test__ = {
    buildUserMediaUrl,
    buildUserByScreenNameUrl,
    parseUserMedia,
    classifyMediaUrl,
};
