import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { resolveTwitterQueryId } from './shared.js';

const BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const CREATE_LIST_QUERY_ID = 'hQAsnViq2BrMLbPuQ9umDA';
const NAME_MAX = 25;
const DESCRIPTION_MAX = 100;

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

cli({
    site: 'twitter',
    name: 'list-create',
    description: 'Create a new Twitter/X list (returns the new list id)',
    domain: 'x.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'name', positional: true, type: 'string', required: true, help: `List name (max ${NAME_MAX} chars)` },
        { name: 'description', type: 'string', default: '', help: `Optional list description (max ${DESCRIPTION_MAX} chars)` },
        { name: 'mode', type: 'string', default: 'public', help: 'public | private' },
    ],
    columns: ['id', 'name', 'description', 'mode', 'status'],
    func: async (page, kwargs) => {
        const name = String(kwargs.name || '').trim();
        const description = String(kwargs.description || '').trim();
        const modeRaw = String(kwargs.mode || 'public').trim().toLowerCase();
        if (!name) {
            throw new CommandExecutionError('List name is required');
        }
        if (name.length > NAME_MAX) {
            throw new CommandExecutionError(`List name too long: ${name.length} chars (max ${NAME_MAX})`);
        }
        if (description.length > DESCRIPTION_MAX) {
            throw new CommandExecutionError(`Description too long: ${description.length} chars (max ${DESCRIPTION_MAX})`);
        }
        if (modeRaw !== 'public' && modeRaw !== 'private') {
            throw new CommandExecutionError(`Invalid mode: ${JSON.stringify(kwargs.mode)}. Expected "public" or "private".`);
        }
        const isPrivate = modeRaw === 'private';

        await page.goto('https://x.com');
        await page.wait(3);
        const ct0 = await page.evaluate(`() => {
            return document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('ct0='))?.split('=')[1] || null;
        }`);
        if (!ct0) throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');

        const queryId = await resolveTwitterQueryId(page, 'CreateList', CREATE_LIST_QUERY_ID);

        const headers = JSON.stringify({
            'Authorization': `Bearer ${decodeURIComponent(BEARER_TOKEN)}`,
            'X-Csrf-Token': ct0,
            'X-Twitter-Auth-Type': 'OAuth2Session',
            'X-Twitter-Active-User': 'yes',
            'Content-Type': 'application/json',
        });
        const body = JSON.stringify({
            variables: { isPrivate, name, description },
            features: FEATURES,
            queryId,
        });
        const apiUrl = `/i/api/graphql/${queryId}/CreateList`;

        const result = await page.evaluate(`async () => {
            const r = await fetch(${JSON.stringify(apiUrl)}, {
                method: 'POST',
                headers: ${headers},
                credentials: 'include',
                body: ${JSON.stringify(body)},
            });
            const text = await r.text();
            let json = null;
            try { json = JSON.parse(text); } catch {}
            return { ok: r.ok, status: r.status, json, text };
        }`);

        if (!result.ok) {
            const snippet = (result.text || '').slice(0, 300);
            throw new CommandExecutionError(`HTTP ${result.status} from CreateList: ${snippet}`);
        }
        const errors = result.json?.errors;
        if (Array.isArray(errors) && errors.length > 0) {
            throw new CommandExecutionError(`CreateList failed: ${errors[0].message || JSON.stringify(errors[0])}`);
        }
        const list = result.json?.data?.list;
        if (!list || !(list.id_str || list.id)) {
            throw new CommandExecutionError(`CreateList returned no list payload. Body: ${(result.text || '').slice(0, 300)}`);
        }
        const id = String(list.id_str || list.id);
        const mode = typeof list.mode === 'string' && /private/i.test(list.mode) ? 'private' : 'public';
        return [{
            id,
            name: list.name || name,
            description: list.description || description,
            mode,
            status: 'success',
        }];
    },
});
