import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { extractMedia, normalizeTwitterGraphqlPayload, resolveTwitterOperationMetadata } from './shared.js';
import { TWITTER_BEARER_TOKEN, applyTopByEngagement } from './utils.js';

// ── Public-search operator surface ─────────────────────────────────────
//
// X's web search supports a small set of inline operators (from:, filter:,
// -filter:, etc.) plus a tab-selector URL param `f=`. We expose the most
// useful subset as flags so callers don't have to memorise the operator
// strings, while still letting power users append raw operators in <query>.

/** Operands accepted by `--has`. Map 1:1 to Twitter's `filter:<x>` operator. */
const HAS_CHOICES = Object.freeze(['media', 'images', 'videos', 'links', 'replies']);

/**
 * Operands accepted by `--exclude`. Note that `retweets` is exposed as the
 * friendlier name but X's actual operator stays as `-filter:nativeretweets`
 * (the historical "native" prefix is preserved by their backend).
 */
const EXCLUDE_CHOICES = Object.freeze(['replies', 'retweets', 'media', 'links']);

/**
 * Operands accepted by `--product`. `photos`/`videos` are the human-friendly
 * forms used by the X UI tabs; the URL param uses the singular forms (image,
 * video). `people` is intentionally NOT supported here because that tab
 * returns User objects, not tweets, and would need a different output schema.
 */
const PRODUCT_CHOICES = Object.freeze(['top', 'live', 'photos', 'videos']);

const PRODUCT_TO_F_PARAM = Object.freeze({
    top: 'top',
    live: 'live',
    photos: 'image',
    videos: 'video',
});

const PRODUCT_TO_GRAPHQL_PRODUCT = Object.freeze({
    top: 'Top',
    live: 'Latest',
    photos: 'Photos',
    videos: 'Videos',
});
const MAX_PAGINATION_PAGES = 100;

const SEARCH_TIMELINE_OPERATION = {
    queryId: 'VhUd6vHVmLBcw0uX-6jMLA',
    features: {
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
    },
    fieldToggles: {
        withPayments: true,
        withAuxiliaryUserLabels: true,
        withArticleRichContentState: true,
        withArticlePlainText: true,
        withArticleSummaryText: true,
        withArticleVoiceOver: true,
        withGrokAnalyze: true,
        withDisallowedReplyControls: true,
    },
};

const FROM_USER_PATTERN = /^[A-Za-z0-9_]{1,15}$/;

const EXCLUDE_TO_OPERATOR = Object.freeze({
    replies: '-filter:replies',
    // `retweets` is a CLI-friendly alias for X's actual `-filter:nativeretweets`.
    retweets: '-filter:nativeretweets',
    media: '-filter:media',
    links: '-filter:links',
});

/**
 * Compose the final search query string by appending operator clauses for
 * --from / --has / --exclude. Pure synchronous — exported via __test__ for
 * unit coverage.
 *
 * Behaviour notes:
 * - Trims leading `@` from --from so callers can pass `@alice` or `alice`.
 * - Order is `<query> from:X filter:Y -filter:Z` (matches what X's own search
 *   bar emits when you click the suggestions UI).
 * - Empty <query> with non-empty filters is allowed — the resulting string
 *   is just the operator clauses joined; X handles that fine.
 *
 * @param {string} rawQuery
 * @param {{ from?: string, has?: string, exclude?: string }} kwargs
 * @returns {string}
 */
function buildSearchQuery(rawQuery, kwargs) {
    const parts = [String(rawQuery ?? '').trim()];
    if (kwargs.from) {
        const fromUser = String(kwargs.from).trim().replace(/^@+/, '');
        if (fromUser && !FROM_USER_PATTERN.test(fromUser)) {
            throw new ArgumentError(
                `Invalid --from username: ${JSON.stringify(kwargs.from)}`,
                'Use a Twitter/X handle with 1-15 letters, numbers, or underscores; omit @ or pass @handle.',
            );
        }
        if (fromUser) parts.push(`from:${fromUser}`);
    }
    if (kwargs.has) {
        parts.push(`filter:${kwargs.has}`);
    }
    if (kwargs.exclude) {
        const op = EXCLUDE_TO_OPERATOR[kwargs.exclude];
        if (op) parts.push(op);
    }
    return parts.filter(Boolean).join(' ');
}

/**
 * Resolve which X search tab (`f=` URL param) to land on. `--product` wins
 * over the legacy `--filter` so adding `--product` doesn't break callers that
 * were already setting `--filter top|live`.
 *
 * @param {{ product?: string, filter?: string }} kwargs
 * @returns {string} URL `f=` value: top|live|image|video
 */
function resolveSearchFParam(kwargs) {
    if (kwargs.product) {
        const mapped = PRODUCT_TO_F_PARAM[kwargs.product];
        if (mapped) return mapped;
    }
    return kwargs.filter === 'live' ? 'live' : 'top';
}

function resolveSearchProduct(kwargs) {
    const product = kwargs.product || (kwargs.filter === 'live' ? 'live' : 'top');
    return PRODUCT_TO_GRAPHQL_PRODUCT[product] || 'Top';
}

function normalizeOperation(operation) {
    if (typeof operation === 'string') {
        return {
            queryId: operation,
            features: SEARCH_TIMELINE_OPERATION.features,
            fieldToggles: SEARCH_TIMELINE_OPERATION.fieldToggles,
        };
    }
    return {
        queryId: operation?.queryId || SEARCH_TIMELINE_OPERATION.queryId,
        features: operation?.features || SEARCH_TIMELINE_OPERATION.features,
        fieldToggles: operation?.fieldToggles || SEARCH_TIMELINE_OPERATION.fieldToggles,
    };
}

function buildSearchTimelineRequest(operation, rawQuery, product, count, cursor) {
    const normalized = normalizeOperation(operation);
    const vars = {
        rawQuery,
        count,
        querySource: 'typed_query',
        product,
    };
    if (cursor) vars.cursor = cursor;
    return [
        `/i/api/graphql/${normalized.queryId}/SearchTimeline`,
        {
            variables: vars,
            features: normalized.features,
            fieldToggles: normalized.fieldToggles,
        },
    ];
}

function unwrapTweetResult(result) {
    if (!result) return null;
    if (result.__typename === 'TweetWithVisibilityResults' && result.tweet) return result.tweet;
    if (result.tweet) return result.tweet;
    return result;
}

function tweetToRow(result, seen) {
    const tweet = unwrapTweetResult(result);
    if (!tweet?.rest_id || seen.has(tweet.rest_id)) return null;
    seen.add(tweet.rest_id);
    const tweetUser = tweet.core?.user_results?.result;
    return {
        id: tweet.rest_id,
        author: tweetUser?.core?.screen_name || tweetUser?.legacy?.screen_name || 'unknown',
        text: tweet.note_tweet?.note_tweet_results?.result?.text || tweet.legacy?.full_text || '',
        created_at: tweet.legacy?.created_at || '',
        likes: tweet.legacy?.favorite_count || 0,
        views: tweet.views?.count || '0',
        url: `https://x.com/i/status/${tweet.rest_id}`,
        ...extractMedia(tweet.legacy),
    };
}

function parseSearchTimeline(data, seen) {
    const rows = [];
    let nextCursor = null;
    const instructions = data?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions || [];
    const visit = (value) => {
        if (!value || typeof value !== 'object') return;
        if (value.tweet_results?.result) {
            const row = tweetToRow(value.tweet_results.result, seen);
            if (row) rows.push(row);
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
    return { rows, nextCursor };
}

cli({
    site: 'twitter',
    name: 'search',
    access: 'read',
    description: 'Search Twitter/X for tweets, with optional --from / --has / --exclude / --product filters mapped to X\'s search operators',
    domain: 'x.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'query', type: 'string', required: true, positional: true, help: 'Search query. Raw X operators (e.g. "exact phrase", #tag, OR, lang:en, since:YYYY-MM-DD, from:, since:) are passed through unchanged.' },
        { name: 'filter', type: 'string', default: 'top', choices: ['top', 'live'], help: 'Legacy alias for --product. Kept for backwards compatibility; if --product is set it wins.' },
        { name: 'product', type: 'string', choices: PRODUCT_CHOICES, help: 'Which X search tab to read: top (default), live (Latest), photos, videos. Maps to the f= URL param.' },
        { name: 'from', type: 'string', help: 'Restrict to tweets authored by <user>. Leading @ is stripped. Equivalent to appending `from:<user>` to the query.' },
        { name: 'has', type: 'string', choices: HAS_CHOICES, help: 'Restrict to tweets that have media|images|videos|links|replies. Maps to X\'s `filter:<has>` operator.' },
        { name: 'exclude', type: 'string', choices: EXCLUDE_CHOICES, help: 'Exclude tweets matching <type>: replies|retweets|media|links. Maps to X\'s `-filter:<x>` operator (retweets → -filter:nativeretweets).' },
        { name: 'limit', type: 'int', default: 15, help: 'Maximum number of tweets to return (default 15). Result count after server-side filtering.' },
        { name: 'top-by-engagement', type: 'int', default: 0, help: 'When set to N>0, re-rank the results by weighted engagement (likes×1 + retweets×3 + replies×2 + bookmarks×5 + log10(views+1)×0.5) and return the top N. Default 0 keeps X\'s native ordering.' },
    ],
    columns: ['id', 'author', 'text', 'created_at', 'likes', 'views', 'url', 'has_media', 'media_urls'],
    func: async (page, kwargs) => {
        const finalQuery = buildSearchQuery(kwargs.query, kwargs);
        if (!finalQuery) {
            throw new ArgumentError('twitter search query is empty', 'Provide a non-empty <query>, or use at least one of --from / --has / --exclude.');
        }
        if (!Number.isInteger(Number(kwargs.limit)) || Number(kwargs.limit) <= 0) {
            throw new ArgumentError('twitter search --limit must be a positive integer', 'Example: opencli twitter search opencli --limit 15');
        }
        const cookies = await page.getCookies({ url: 'https://x.com' });
        const ct0 = cookies.find((c) => c.name === 'ct0')?.value || null;
        if (!ct0) throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');
        await page.goto('https://x.com/home', { waitUntil: 'load', settleMs: 1000 });
        const operation = await resolveTwitterOperationMetadata(page, 'SearchTimeline', SEARCH_TIMELINE_OPERATION);
        const headers = JSON.stringify({
            'Authorization': `Bearer ${decodeURIComponent(TWITTER_BEARER_TOKEN)}`,
            'X-Csrf-Token': ct0,
            'X-Twitter-Auth-Type': 'OAuth2Session',
            'X-Twitter-Active-User': 'yes',
            'Content-Type': 'application/json',
        });
        const product = resolveSearchProduct(kwargs);
        const results = [];
        const seen = new Set();
        let cursor = null;
        // Runaway guard only; --limit and cursor exhaustion control normal pagination.
        for (let i = 0; i < MAX_PAGINATION_PAGES && results.length < kwargs.limit; i++) {
            const fetchCount = Number(kwargs.limit) - results.length + 10;
            const [requestUrl, requestPayload] = buildSearchTimelineRequest(operation, finalQuery, product, fetchCount, cursor);
            const requestBody = JSON.stringify(requestPayload);
            const data = normalizeTwitterGraphqlPayload(await page.evaluate(`async () => {
        const options = {
          method: 'POST',
          headers: ${headers},
          credentials: 'include',
        };
        options['body'] = ${JSON.stringify(requestBody)};
        const r = await fetch(${JSON.stringify(requestUrl)}, {
          ...options,
        });
        return r.ok ? await r.json() : { error: r.status };
      }`));
            if (data?.error) {
                if (results.length === 0) throw new CommandExecutionError(`HTTP ${data.error}: SearchTimeline fetch failed — queryId may have expired`);
                break;
            }
            const { rows, nextCursor } = parseSearchTimeline(data, seen);
            results.push(...rows);
            if (!nextCursor || nextCursor === cursor) break;
            cursor = nextCursor;
        }
        const trimmed = results.slice(0, kwargs.limit);
        return applyTopByEngagement(trimmed, kwargs['top-by-engagement']);
    }
});

export const __test__ = {
    buildSearchQuery,
    resolveSearchFParam,
    resolveSearchProduct,
    buildSearchTimelineRequest,
    parseSearchTimeline,
    HAS_CHOICES,
    EXCLUDE_CHOICES,
    PRODUCT_CHOICES,
    EXCLUDE_TO_OPERATOR,
    PRODUCT_TO_F_PARAM,
    FROM_USER_PATTERN,
};
