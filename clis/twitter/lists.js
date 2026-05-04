import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';

const BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const LISTS_QUERY_ID = '78UbkyXwXBD98IgUWXOy9g';
const OPERATION_NAME = 'ListsManagementPageTimeline';

const FEATURES = {
    rweb_video_screen_enabled: false,
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
    responsive_web_jetfuel_frame: false,
    responsive_web_grok_share_attachment_enabled: true,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    responsive_web_grok_show_grok_translated_post: false,
    responsive_web_grok_analysis_button_from_backend: false,
    creator_subscriptions_quote_tweet_preview_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_grok_image_annotation_enabled: true,
    responsive_web_enhance_cards_enabled: false,
};

function buildUrl(queryId) {
    return `/i/api/graphql/${queryId}/${OPERATION_NAME}`
        + `?features=${encodeURIComponent(JSON.stringify(FEATURES))}`;
}

export function extractListEntry(entry, seen) {
    const list = entry?.content?.itemContent?.list
        || entry?.content?.list
        || entry?.item?.itemContent?.list;
    if (!list) return null;
    const id = list.id_str || list.id || '';
    if (!id || seen.has(id)) return null;
    seen.add(id);
    const mode = typeof list.mode === 'string' && /private/i.test(list.mode) ? 'private' : 'public';
    return {
        id: String(id),
        name: list.name || '',
        members: String(list.member_count ?? 0),
        followers: String(list.subscriber_count ?? 0),
        mode,
    };
}

export function parseListsManagement(data, seen) {
    const lists = [];
    const instructions = data?.data?.viewer?.list_management_timeline?.timeline?.instructions
        || data?.data?.viewer_v2?.user_results?.result?.list_management_timeline?.timeline?.instructions
        || data?.data?.list_management_timeline?.timeline?.instructions
        || [];
    for (const inst of instructions) {
        for (const entry of inst.entries || []) {
            const direct = extractListEntry(entry, seen);
            if (direct) {
                lists.push(direct);
                continue;
            }
            for (const item of entry?.content?.items || []) {
                const nested = extractListEntry(item, seen);
                if (nested) lists.push(nested);
            }
        }
    }
    return lists;
}

export const command = cli({
    site: 'twitter',
    name: 'lists',
    access: 'read',
    description: 'Get Twitter/X lists for the logged-in user (owned + subscribed)',
    domain: 'x.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 50 },
    ],
    columns: ['id', 'name', 'members', 'followers', 'mode'],
    func: async (page, kwargs) => {
        const limit = kwargs.limit || 50;
        await page.goto('https://x.com');
        await page.wait(3);
        const ct0 = await page.evaluate(`() => {
            return document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('ct0='))?.split('=')[1] || null;
        }`);
        if (!ct0)
            throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');
        const queryId = await page.evaluate(`async () => {
            try {
                const ghResp = await fetch('https://raw.githubusercontent.com/fa0311/twitter-openapi/refs/heads/main/src/config/placeholder.json');
                if (ghResp.ok) {
                    const data = await ghResp.json();
                    const entry = data['${OPERATION_NAME}'];
                    if (entry && entry.queryId) return entry.queryId;
                }
            } catch {}
            try {
                const scripts = performance.getEntriesByType('resource')
                    .filter(r => r.name.includes('client-web') && r.name.endsWith('.js'))
                    .map(r => r.name);
                for (const scriptUrl of scripts.slice(0, 15)) {
                    try {
                        const text = await (await fetch(scriptUrl)).text();
                        const re = /queryId:"([A-Za-z0-9_-]+)"[^}]{0,200}operationName:"${OPERATION_NAME}"/;
                        const m = text.match(re);
                        if (m) return m[1];
                    } catch {}
                }
            } catch {}
            return null;
        }`) || LISTS_QUERY_ID;
        const headers = JSON.stringify({
            'Authorization': `Bearer ${decodeURIComponent(BEARER_TOKEN)}`,
            'X-Csrf-Token': ct0,
            'X-Twitter-Auth-Type': 'OAuth2Session',
            'X-Twitter-Active-User': 'yes',
        });
        const apiUrl = buildUrl(queryId);
        const data = await page.evaluate(`async () => {
            const r = await fetch(${JSON.stringify(apiUrl)}, { headers: ${headers}, credentials: 'include' });
            return r.ok ? await r.json() : { error: r.status };
        }`);
        if (data?.error) {
            throw new CommandExecutionError(`HTTP ${data.error}: Failed to fetch lists. queryId may have expired.`);
        }
        const seen = new Set();
        const lists = parseListsManagement(data, seen);
        return lists.slice(0, limit);
    },
});
