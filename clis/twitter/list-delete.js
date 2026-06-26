import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { resolveTwitterQueryId, unwrapBrowserResult } from './shared.js';
import { parseListsManagement } from './lists.js';
import { TWITTER_BEARER_TOKEN } from './utils.js';

const LISTS_MANAGEMENT_QUERY_ID = '78UbkyXwXBD98IgUWXOy9g';

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

function normalizeConfirm(value) {
    return value === true || value === 'true';
}

async function getManagedLists(page, headers) {
    const listsQueryId = await resolveTwitterQueryId(page, 'ListsManagementPageTimeline', LISTS_MANAGEMENT_QUERY_ID);
    const listsUrl = `/i/api/graphql/${listsQueryId}/ListsManagementPageTimeline?features=${encodeURIComponent(JSON.stringify(LISTS_MANAGEMENT_FEATURES))}`;
    const listsData = unwrapBrowserResult(await page.evaluate(`async () => {
        const r = await fetch(${JSON.stringify(listsUrl)}, { headers: ${headers}, credentials: 'include' });
        if (!r.ok) return { __error: 'HTTP ' + r.status };
        return await r.json();
    }`));
    if (listsData && listsData.__error) {
        throw new CommandExecutionError(`Could not fetch lists: ${listsData.__error}`);
    }
    return parseListsManagement(listsData, new Set());
}

export function buildListDeleteRow({ listId, targetList }) {
    return {
        listId,
        name: targetList.name,
        members: String(targetList.members ?? '0'),
        status: 'success',
        message: `Deleted list ${targetList.name} (${targetList.members ?? '0'} members)`,
    };
}

cli({
    site: 'twitter',
    name: 'list-delete',
    access: 'write',
    description: 'Delete a Twitter/X list you own after explicit confirmation',
    domain: 'x.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'listId', positional: true, type: 'string', required: true, help: 'Numeric ID of the list you own (e.g. from `opencli twitter lists`)' },
        { name: 'confirm', type: 'boolean', default: false, help: 'Required. Set --confirm true to delete the list.' },
        { name: 'timeout', type: 'int', default: 300, help: 'Max seconds for the overall delete command (default: 300)' },
    ],
    columns: ['listId', 'name', 'members', 'status', 'message'],
    func: async (page, kwargs) => {
        const listId = String(kwargs.listId || '').trim();
        if (!listId || !/^\d+$/.test(listId)) {
            throw new ArgumentError(`Invalid listId: ${JSON.stringify(kwargs.listId)}. Expected numeric ID.`, 'Example: opencli twitter list-delete 123456789 --confirm true');
        }
        if (!normalizeConfirm(kwargs.confirm)) {
            throw new ArgumentError('Refusing to delete list without --confirm true', 'Example: opencli twitter list-delete 123456789 --confirm true');
        }

        await page.goto('https://x.com');
        await page.wait(3);
        const cookies = await page.getCookies({ url: 'https://x.com' });
        const ct0 = cookies.find((c) => c.name === 'ct0')?.value || null;
        if (!ct0) throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');

        const headers = JSON.stringify({
            'Authorization': `Bearer ${decodeURIComponent(TWITTER_BEARER_TOKEN)}`,
            'X-Csrf-Token': ct0,
            'X-Twitter-Auth-Type': 'OAuth2Session',
            'X-Twitter-Active-User': 'yes',
        });

        const listsBefore = await getManagedLists(page, headers);
        const targetList = listsBefore.find((list) => list.id === listId);
        if (!targetList) {
            throw new CommandExecutionError(`List ${listId} not found among your lists (${listsBefore.length} lists fetched).`);
        }

        await page.goto(`https://x.com/i/lists/${listId}`);
        await page.wait({ selector: '[data-testid="primaryColumn"]' });
        const deleteResult = unwrapBrowserResult(await page.evaluate(`(async () => {
            const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
            const visible = (el) => !!el && el.offsetParent !== null;
            const buttonText = (el) => (el.innerText || el.textContent || '').trim();
            const waitFor = async (fn, { timeoutMs = 10000, intervalMs = 200 } = {}) => {
                const started = Date.now();
                while (Date.now() - started < timeoutMs) {
                    const value = fn();
                    if (value) return value;
                    await sleep(intervalMs);
                }
                return null;
            };
            const findButton = (text) => Array.from(document.querySelectorAll('button, [role="button"]'))
                .find((el) => visible(el) && buttonText(el).toLowerCase() === text.toLowerCase());
            const editLink = Array.from(document.querySelectorAll('a[href$="/info"]'))
                .find((el) => visible(el) && /edit list/i.test(el.innerText || el.textContent || ''));
            if (!editLink) return { ok: false, message: 'Edit List link not found' };
            editLink.click();
            const editDialog = await waitFor(() => document.querySelector('[role="dialog"]'));
            if (!editDialog) return { ok: false, message: 'Edit List dialog did not open' };
            const deleteButton = findButton('Delete List');
            if (!deleteButton) return { ok: false, message: 'Delete List button not found' };
            deleteButton.click();
            await sleep(800);
            const confirmButton = document.querySelector('[data-testid="confirmationSheetConfirm"]')
                || findButton('Delete');
            if (!confirmButton) return { ok: false, message: 'Delete confirmation button not found' };
            confirmButton.click();
            await sleep(2500);
            return { ok: true, url: location.href };
        })()`));
        if (!deleteResult?.ok) {
            throw new CommandExecutionError(`Failed to delete list ${listId}: ${deleteResult?.message || 'unknown UI failure'}`);
        }

        const listsAfter = await getManagedLists(page, headers);
        if (listsAfter.some((list) => list.id === listId)) {
            throw new CommandExecutionError(`Failed to delete list ${listId}: list still appears in managed lists.`);
        }

        return [buildListDeleteRow({ listId, targetList })];
    },
});
