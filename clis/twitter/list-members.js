import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { describeTwitterApiError, resolveTwitterOperationMetadata, unwrapBrowserResult } from './shared.js';
import { TWITTER_BEARER_TOKEN } from './utils.js';

const OPERATION_NAME = 'ListMembers';
const MAX_PAGINATION_PAGES = 100;
// Rows requested per GraphQL page; --limit is applied to the collected rows.
const PAGE_SIZE = 100;
const LIST_MEMBERS_OPERATION = {
    queryId: '_RDpx--fQKSccuRlGpEIoA',
    features: {
        rweb_video_screen_enabled: false,
        profile_label_improvements_pcf_label_in_post_enabled: true,
        responsive_web_profile_redirect_enabled: true,
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
        content_disclosure_indicator_enabled: true,
        content_disclosure_ai_generated_indicator_enabled: true,
        responsive_web_grok_show_grok_translated_post: true,
        responsive_web_grok_analysis_button_from_backend: true,
        post_ctas_fetch_enabled: false,
        freedom_of_speech_not_reach_fetch_enabled: true,
        standardized_nudges_misinfo: true,
        tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
        longform_notetweets_rich_text_read_enabled: true,
        longform_notetweets_inline_media_enabled: false,
        responsive_web_grok_image_annotation_enabled: true,
        responsive_web_grok_imagine_annotation_enabled: true,
        responsive_web_grok_community_note_auto_translation_is_enabled: true,
        responsive_web_enhance_cards_enabled: false,
    },
};

function buildListMembersUrl(operation, listId, count, cursor) {
    const vars = { listId: String(listId), count };
    if (cursor)
        vars.cursor = cursor;
    return `/i/api/graphql/${operation.queryId}/${OPERATION_NAME}`
        + `?variables=${encodeURIComponent(JSON.stringify(vars))}`
        + `&features=${encodeURIComponent(JSON.stringify(operation.features))}`;
}

function extractMember(result) {
    if (!result || result.__typename !== 'User')
        return null;
    const core = result.core || {};
    const legacy = result.legacy || {};
    const screenName = core.screen_name || legacy.screen_name || '';
    if (!screenName) {
        throw new CommandExecutionError('Malformed Twitter list member: missing screen_name');
    }
    return {
        screen_name: screenName,
        name: core.name || legacy.name || '',
        bio: result.profile_bio?.description || legacy.description || '',
        followers: result.relationship_counts?.followers
            ?? legacy.followers_count
            ?? legacy.normal_followers_count
            ?? 0,
        verified: Boolean(result.is_blue_verified || legacy.verified),
        user_id: result.rest_id || '',
    };
}

/** Returns null instructions when the payload carries no members timeline (missing or inaccessible list). */
function parseListMembers(data) {
    const instructions = data?.data?.list?.members_timeline?.timeline?.instructions;
    if (!Array.isArray(instructions))
        return { users: [], nextCursor: null, instructions: null };
    const users = [];
    let nextCursor = null;
    for (const inst of instructions) {
        for (const entry of inst.entries || []) {
            const content = entry.content;
            if (content?.entryType === 'TimelineTimelineCursor' || content?.__typename === 'TimelineTimelineCursor') {
                if (content.cursorType === 'Bottom' || content.cursorType === 'ShowMore')
                    nextCursor = content.value;
                continue;
            }
            if (entry.entryId?.startsWith('user-')) {
                const user = extractMember(content?.itemContent?.user_results?.result);
                if (user)
                    users.push(user);
            }
        }
    }
    return { users, nextCursor, instructions };
}

cli({
    site: 'twitter',
    name: 'list-members',
    access: 'read',
    description: 'List the member accounts of a Twitter/X list',
    domain: 'x.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'listId', positional: true, type: 'string', required: true, help: 'Numeric ID of a Twitter/X list (e.g. from `opencli twitter lists`)' },
        { name: 'limit', type: 'int', default: 100, help: 'Maximum number of members to return (default 100). Must be a positive integer.' },
    ],
    columns: ['screen_name', 'name', 'bio', 'followers', 'verified', 'user_id'],
    func: async (page, kwargs) => {
        const listId = String(kwargs.listId ?? '').trim();
        if (!/^\d+$/.test(listId)) {
            throw new ArgumentError(`twitter list-members listId must be numeric, got ${JSON.stringify(kwargs.listId)}`, 'Example: opencli twitter list-members 1141162794290520064 (see `opencli twitter lists`)');
        }
        const limit = kwargs.limit === undefined || kwargs.limit === null ? 100 : Number(kwargs.limit);
        if (!Number.isInteger(limit) || limit <= 0) {
            throw new ArgumentError('twitter list-members --limit must be a positive integer', 'Example: opencli twitter list-members 1141162794290520064 --limit 500');
        }
        const cookies = await page.getCookies({ url: 'https://x.com' });
        const ct0 = cookies.find((c) => c.name === 'ct0')?.value || null;
        if (!ct0)
            throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');

        const operation = await resolveTwitterOperationMetadata(page, OPERATION_NAME, LIST_MEMBERS_OPERATION);
        const headers = JSON.stringify({
            'Authorization': `Bearer ${decodeURIComponent(TWITTER_BEARER_TOKEN)}`,
            'X-Csrf-Token': ct0,
            'X-Twitter-Auth-Type': 'OAuth2Session',
            'X-Twitter-Active-User': 'yes',
        });

        const members = [];
        const seen = new Set();
        let cursor = null;
        let sawTimeline = false;
        // Runaway guard only; --limit and cursor exhaustion control normal pagination.
        for (let i = 0; i < MAX_PAGINATION_PAGES && members.length < limit; i++) {
            const apiUrl = buildListMembersUrl(operation, listId, PAGE_SIZE, cursor);
            const data = unwrapBrowserResult(await page.evaluate(`async () => {
                const r = await fetch(${JSON.stringify(apiUrl)}, { headers: ${headers}, credentials: 'include' });
                return r.ok ? await r.json() : { error: r.status };
            }`));
            if (data?.error) {
                if (data.error === 401 || data.error === 403)
                    throw new AuthRequiredError('x.com', `Twitter list members request failed (HTTP ${data.error})`);
                throw new CommandExecutionError(describeTwitterApiError(OPERATION_NAME, data.error, 'list may be private'));
            }
            const { users, nextCursor, instructions } = parseListMembers(data);
            if (!instructions) {
                if (!sawTimeline)
                    throw new EmptyResultError('twitter list-members', `List ${listId} returned no members timeline (it may not exist or may be private)`);
                throw new CommandExecutionError(`Twitter list members pagination returned an unexpected payload after ${members.length} rows`);
            }
            sawTimeline = true;
            const before = members.length;
            for (const user of users) {
                if (!seen.has(user.screen_name)) {
                    seen.add(user.screen_name);
                    members.push(user);
                }
            }
            if (!nextCursor || nextCursor === cursor || members.length === before)
                break;
            cursor = nextCursor;
        }
        if (members.length === 0) {
            throw new EmptyResultError('twitter list-members', `List ${listId} has no members`);
        }
        return members.slice(0, limit);
    },
});

export const __test__ = {
    buildListMembersUrl,
    extractMember,
    parseListMembers,
};
