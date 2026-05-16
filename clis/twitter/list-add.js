import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { resolveTwitterQueryId } from './shared.js';
import { parseListsManagement } from './lists.js';
import { TWITTER_BEARER_TOKEN } from './utils.js';

const USER_BY_SCREEN_NAME_QUERY_ID = 'qRednkZG-rn1P6b48NINmQ';
const LISTS_MANAGEMENT_QUERY_ID = '78UbkyXwXBD98IgUWXOy9g';
// 2026-05 fallback — X rotates queryIds; resolveTwitterQueryId() does live lookup,
// this constant is just the default if live lookup fails.
const LIST_ADD_MEMBER_QUERY_ID = 'vWPi0CTMoPFsjsL6W4IynQ';

const LISTS_MANAGEMENT_FEATURES = {
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

function fatalGraphqlErrors(errors) {
    const list = Array.isArray(errors) ? errors : [];
    return list.filter((e) =>
        !(e?.path || []).join('.').includes('default_banner_media_results')
        && !/decode/i.test(e?.message || '')
    );
}

export function buildListAddMemberRow({ addResult, memberCountBefore, listId, username, userId }) {
    if (!addResult?.httpOk) {
        throw new CommandExecutionError(
            `Failed to add @${username} to list ${listId}: HTTP ${addResult?.status ?? 0}${addResult?.fetchError ? ' (' + addResult.fetchError + ')' : ''}${addResult?.raw ? ' — ' + addResult.raw : ''}`
        );
    }

    // X often returns a partial GraphQL error on `default_banner_media_results`
    // even on successful mutations. Treat only missing main data or non-decode
    // GraphQL errors as command failures.
    const hasMemberCount = addResult.mc !== null && addResult.mc !== undefined;
    const fatalErrors = fatalGraphqlErrors(addResult.errors);
    if (!hasMemberCount && fatalErrors.length) {
        const msg = fatalErrors.map((e) => e.message || JSON.stringify(e)).join('; ');
        throw new CommandExecutionError(`Failed to add @${username} to list ${listId}: ${msg.slice(0, 300)}`);
    }
    if (!hasMemberCount) {
        throw new CommandExecutionError(`Failed to add @${username} to list ${listId}: no member_count in response`);
    }

    const memberCountAfter = Number(addResult.mc);
    if (!Number.isFinite(memberCountAfter)) {
        throw new CommandExecutionError(`Failed to add @${username} to list ${listId}: invalid member_count in response`);
    }

    if (memberCountAfter < memberCountBefore) {
        throw new CommandExecutionError(
            `Failed to add @${username} to list ${listId}: member_count decreased unexpectedly (${memberCountBefore} → ${memberCountAfter})`
        );
    }

    const countIncreased = memberCountAfter > memberCountBefore;
    if (!countIncreased && addResult.isMember !== true) {
        throw new CommandExecutionError(
            `Failed to add @${username} to list ${listId}: member_count unchanged (${memberCountBefore} → ${memberCountAfter}) and response did not confirm membership`
        );
    }

    const noop = !countIncreased;
    const verifiedBy = `member_count ${memberCountBefore} → ${memberCountAfter}`;
    return {
        listId,
        username,
        userId: String(userId),
        status: noop ? 'noop' : 'success',
        message: noop
            ? `@${username} is already a member of list ${listId}`
            : `Added @${username} to list ${listId} (verified via ${verifiedBy})`,
    };
}

cli({
    site: 'twitter',
    name: 'list-add',
    access: 'write',
    description: 'Add a user to a Twitter/X list you own (no-op if already a member)',
    domain: 'x.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'listId', positional: true, type: 'string', required: true, help: 'Numeric ID of the list you own (e.g. from `opencli twitter lists`)' },
        { name: 'username', positional: true, type: 'string', required: true, help: 'Twitter/X handle to add (with or without @)' },
    ],
    columns: ['listId', 'username', 'userId', 'status', 'message'],
    func: async (page, kwargs) => {
        const listId = String(kwargs.listId || '').trim();
        const username = String(kwargs.username || '').replace(/^@/, '').trim();
        if (!listId || !/^\d+$/.test(listId)) {
            throw new ArgumentError(`Invalid listId: ${JSON.stringify(kwargs.listId)}. Expected numeric ID.`, 'Example: opencli twitter list-add 123456789 alice');
        }
        if (!username) {
            throw new ArgumentError('twitter list-add username is required', 'Example: opencli twitter list-add 123456789 alice');
        }
        // Strategy.UI does not get a domain URL pre-nav from the framework.
        // This page context is load-bearing for pre-target GraphQL calls below.
        await page.goto('https://x.com');
        await page.wait(3);
        const cookies = await page.getCookies({ url: 'https://x.com' });
        const ct0 = cookies.find((c) => c.name === 'ct0')?.value || null;
        if (!ct0) throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');

        const userByScreenNameQueryId = await resolveTwitterQueryId(page, 'UserByScreenName', USER_BY_SCREEN_NAME_QUERY_ID);

        const headers = JSON.stringify({
            'Authorization': `Bearer ${decodeURIComponent(TWITTER_BEARER_TOKEN)}`,
            'X-Csrf-Token': ct0,
            'X-Twitter-Auth-Type': 'OAuth2Session',
            'X-Twitter-Active-User': 'yes',
        });

        // opencli >=1.7.x wraps page.evaluate return values as { session, data }.
        // Unwrap before use so JSON.stringify of nested values doesn't become "[object Object]".
        const unwrap = (v) => (v && typeof v === 'object' && 'session' in v && 'data' in v ? v.data : v);

        const userLookupUrl = buildUserByScreenNameUrl(userByScreenNameQueryId, username);
        const userIdRaw = await page.evaluate(`async () => {
            const resp = await fetch(${JSON.stringify(userLookupUrl)}, { headers: ${headers}, credentials: 'include' });
            if (!resp.ok) return null;
            const d = await resp.json();
            return d.data?.user?.result?.rest_id || null;
        }`);
        const userId = unwrap(userIdRaw);
        if (!userId) {
            throw new CommandExecutionError(`Could not resolve user @${username}`);
        }

        // ListsManagementPageTimeline — used for list existence check + before/after member_count.
        const listsQueryId = await resolveTwitterQueryId(page, 'ListsManagementPageTimeline', LISTS_MANAGEMENT_QUERY_ID);
        const listsUrl = `/i/api/graphql/${listsQueryId}/ListsManagementPageTimeline?features=${encodeURIComponent(JSON.stringify(LISTS_MANAGEMENT_FEATURES))}`;
        const listsDataRaw = await page.evaluate(`async () => {
            const r = await fetch(${JSON.stringify(listsUrl)}, { headers: ${headers}, credentials: 'include' });
            if (!r.ok) return { __error: 'HTTP ' + r.status };
            return await r.json();
        }`);
        // Don't unwrap listsData: opencli spreads GraphQL response to top-level + adds session;
        // parseListsManagement reads `.data.viewer.*` from this shape directly.
        const listsData = listsDataRaw;
        const parsedLists = listsData && !listsData.__error
            ? parseListsManagement(listsData, new Set())
            : [];
        if (listsData && listsData.__error) {
            throw new CommandExecutionError(`Could not fetch lists: ${listsData.__error}`);
        }
        const targetList = parsedLists.find((l) => l.id === listId);
        if (!targetList) {
            throw new CommandExecutionError(`List ${listId} not found among your lists (${parsedLists.length} lists fetched).`);
        }

        // Direct GraphQL ListAddMember mutation.
        //
        // Previously this command opened the X profile, clicked "…" → "Add/remove from Lists",
        // navigated the dialog and used nativeClick on the Save button. In 2026-05 X replaced
        // the dialog with a full-page route (/i/lists/add_member), breaking that UI flow.
        //
        // The mutation is the same one the UI fires under the hood; calling it directly is
        // both more reliable and ~10x faster (no goto-profile + scroll-dialog roundtrip).
        const memberCountBefore = Number(targetList.members) || 0;
        const listAddMemberQueryId = await resolveTwitterQueryId(page, 'ListAddMember', LIST_ADD_MEMBER_QUERY_ID);
        const addUrl = `/i/api/graphql/${listAddMemberQueryId}/ListAddMember`;
        const addBody = JSON.stringify({
            variables: { listId, userId: String(userId) },
            queryId: listAddMemberQueryId,
        });
        const addResultJsonRaw = await page.evaluate(`async () => {
            try {
                const r = await fetch(${JSON.stringify(addUrl)}, {
                    method: 'POST',
                    headers: Object.assign({}, ${headers}, { 'Content-Type': 'application/json' }),
                    credentials: 'include',
                    body: ${JSON.stringify(addBody)},
                });
                const text = await r.text();
                let body;
                let raw = null;
                try { body = JSON.parse(text); } catch { body = null; raw = text.slice(0, 300); }
                const list = body && body.data && body.data.list ? body.data.list : null;
                return JSON.stringify([
                    r.ok,
                    r.status,
                    list ? list.member_count : null,
                    list ? list.is_member : null,
                    body && body.errors ? body.errors : null,
                    raw,
                    null,
                ]);
            } catch (e) {
                return JSON.stringify([false, 0, null, null, null, null, String(e)]);
            }
        }`);
        const addResultJson = unwrap(addResultJsonRaw);
        let addResultTuple;
        try {
            addResultTuple = JSON.parse(addResultJson);
        } catch {
            throw new CommandExecutionError(`Failed to add @${username} to list ${listId}: malformed mutation response envelope`);
        }
        const addResult = Object.create(null);
        addResult.httpOk = Boolean(addResultTuple?.[0]);
        addResult.status = Number(addResultTuple?.[1]) || 0;
        addResult.mc = addResultTuple?.[2];
        addResult.isMember = addResultTuple?.[3];
        addResult.errors = addResultTuple?.[4];
        addResult.raw = addResultTuple?.[5];
        addResult.fetchError = addResultTuple?.[6];

        return [buildListAddMemberRow({ addResult, memberCountBefore, listId, username, userId })];
    },
});
