import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { resolveTwitterQueryId } from './shared.js';
import { parseListsManagement } from './lists.js';
import { TWITTER_BEARER_TOKEN } from './utils.js';

const USER_BY_SCREEN_NAME_QUERY_ID = 'qRednkZG-rn1P6b48NINmQ';
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

export function interpretRemoveResponse(status, json) {
    if (status === 200 && json && (json.id_str || json.id || json.slug)) return { ok: true };
    if (json && Array.isArray(json.errors) && json.errors.length > 0) {
        const err = json.errors[0];
        return { ok: false, error: `${err.code ? '[' + err.code + '] ' : ''}${err.message || 'Unknown error'}` };
    }
    return { ok: false, error: `HTTP ${status}` };
}

cli({
    site: 'twitter',
    name: 'list-remove',
    access: 'write',
    description: 'Remove a user from a Twitter/X list you own (toggles via UI; no-op if not currently a member)',
    domain: 'x.com',
    strategy: Strategy.UI,
    browser: true,
    args: [
        { name: 'listId', positional: true, type: 'string', required: true, help: 'Numeric ID of the list you own (e.g. from `opencli twitter lists`)' },
        { name: 'username', positional: true, type: 'string', required: true, help: 'Twitter/X handle to remove (with or without @)' },
    ],
    columns: ['listId', 'username', 'userId', 'status', 'message'],
    func: async (page, kwargs) => {
        const listId = String(kwargs.listId || '').trim();
        const username = String(kwargs.username || '').replace(/^@/, '').trim();
        if (!listId || !/^\d+$/.test(listId)) {
            throw new CommandExecutionError(`Invalid listId: ${JSON.stringify(kwargs.listId)}`);
        }
        if (!username) throw new CommandExecutionError('Username is required');

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

        const userLookupUrl = buildUserByScreenNameUrl(userByScreenNameQueryId, username);
        const userId = await page.evaluate(`async () => {
            const resp = await fetch(${JSON.stringify(userLookupUrl)}, { headers: ${headers}, credentials: 'include' });
            if (!resp.ok) return null;
            const d = await resp.json();
            return d.data?.user?.result?.rest_id || null;
        }`);
        if (!userId) throw new CommandExecutionError(`Could not resolve user @${username}`);

        // Resolve listId → name so we can match the dialog row.
        const listsQueryId = await resolveTwitterQueryId(page, 'ListsManagementPageTimeline', LISTS_MANAGEMENT_QUERY_ID);
        const listsUrl = `/i/api/graphql/${listsQueryId}/ListsManagementPageTimeline?features=${encodeURIComponent(JSON.stringify(LISTS_MANAGEMENT_FEATURES))}`;
        const listsData = await page.evaluate(`async () => {
            const r = await fetch(${JSON.stringify(listsUrl)}, { headers: ${headers}, credentials: 'include' });
            if (!r.ok) return { __error: 'HTTP ' + r.status };
            return await r.json();
        }`);
        if (listsData && listsData.__error) {
            throw new CommandExecutionError(`Could not fetch lists: ${listsData.__error}`);
        }
        const parsedLists = parseListsManagement(listsData, new Set());
        const targetList = parsedLists.find((l) => l.id === listId);
        if (!targetList) {
            throw new CommandExecutionError(`List ${listId} not found among your lists.`);
        }
        const targetName = targetList.name;

        await page.goto(`https://x.com/${username}`);
        await page.wait({ selector: '[data-testid="primaryColumn"]' });
        const uiResult = await page.evaluate(`(async () => {
            const sleep = (ms) => new Promise(r => setTimeout(r, ms));
            const findOne = (sel, root = document) => root.querySelector(sel);
            const waitFor = async (fn, { timeoutMs = 8000, intervalMs = 200 } = {}) => {
                const t0 = Date.now();
                while (Date.now() - t0 < timeoutMs) { const v = fn(); if (v) return v; await sleep(intervalMs); }
                return null;
            };
            try {
                if (!window.__opencliListMutations) {
                    window.__opencliListMutations = [];
                    const origFetch = window.fetch.bind(window);
                    window.fetch = async function(...args) {
                        const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
                        const method = (args[1] && args[1].method) || 'GET';
                        let resp;
                        try { resp = await origFetch(...args); } catch (err) {
                            if (/ListAddMember|ListRemoveMember|lists\\/members\\/(create|destroy)/.test(url)) {
                                window.__opencliListMutations.push({ url, method, status: 0, error: String(err), ts: Date.now() });
                            }
                            throw err;
                        }
                        if (/ListAddMember|ListRemoveMember|lists\\/members\\/(create|destroy)/.test(url)) {
                            window.__opencliListMutations.push({ url, method, status: resp.status, ts: Date.now() });
                        }
                        return resp;
                    };
                }
                window.__opencliListMutations.length = 0;

                const caret = await waitFor(() => findOne('[data-testid="userActions"]'));
                if (!caret) return { ok: false, message: 'Could not find user actions (…) button' };
                caret.click();
                await sleep(600);
                const menuItems = Array.from(document.querySelectorAll('[role="menuitem"]'));
                const addToListItem = menuItems.find(el => /add\\/remove|从列表|列表|add to list|add or remove/i.test(el.innerText));
                if (!addToListItem) return { ok: false, message: 'Could not find "Add/remove from Lists" menu item' };
                addToListItem.click();
                await sleep(1200);
                const dialog = await waitFor(() => findOne('[role="dialog"]'));
                if (!dialog) return { ok: false, message: 'List selection dialog did not open' };

                const targetName = ${JSON.stringify(targetName)};
                const scrollCandidates = [
                    dialog.querySelector('[data-viewportview="true"]'),
                    ...Array.from(dialog.querySelectorAll('div')).filter(d => d.scrollHeight > d.clientHeight + 10),
                ].filter(Boolean);
                let scrollEl = scrollCandidates[0] || dialog;
                for (const se of scrollCandidates) {
                    if (se.scrollHeight > se.clientHeight + 10) { scrollEl = se; break; }
                }
                let row = null;
                let lastScrollTop = -1;
                for (let i = 0; i < 12; i++) {
                    const cells = Array.from(dialog.querySelectorAll('[data-testid="cellInnerDiv"]'));
                    row = cells.find(c => (c.innerText || '').split('\\n')[0].trim() === targetName);
                    if (row) break;
                    const prev = scrollEl.scrollTop;
                    scrollEl.scrollTop = prev + Math.max(200, scrollEl.clientHeight - 100);
                    if (scrollEl.scrollTop === prev && scrollEl.scrollTop === lastScrollTop) break;
                    lastScrollTop = scrollEl.scrollTop;
                    await sleep(500);
                }
                if (!row) {
                    const names = Array.from(dialog.querySelectorAll('[data-testid="cellInnerDiv"]'))
                        .map(c => (c.innerText || '').split('\\n')[0].trim()).filter(Boolean);
                    return { ok: false, message: 'List "' + targetName + '" not found in dialog. Saw: ' + names.join(' | ') };
                }

                // Determine current membership: row has a filled checkmark (svg inside a specific container) when member.
                // Heuristic: look for an aria-checked attribute, or an svg with specific fill on the row's right side.
                // The listCell itself carries aria-checked. Require a stable reading
                // (same value twice ~500ms apart) to avoid the X dialog's occasional
                // flash of stale state when re-opened shortly after a toggle.
                const listCell = row.querySelector('[data-testid="listCell"]') || row.querySelector('[role="checkbox"]') || row;
                const readChecked = () => {
                    const v = listCell.getAttribute('aria-checked');
                    return v === 'true' || v === 'false' ? v : null;
                };
                await sleep(600);
                let ariaChecked = readChecked();
                for (let i = 0; i < 8; i++) {
                    await sleep(500);
                    const next = readChecked();
                    if (next && next === ariaChecked) break;
                    ariaChecked = next || ariaChecked;
                }
                const isMember = ariaChecked === 'true';
                if (!isMember) {
                    const closeBtn = findOne('[data-testid="app-bar-close"]') || findOne('[aria-label="Close"]');
                    if (closeBtn) closeBtn.click();
                    return { ok: true, noop: true };
                }
                try { listCell.scrollIntoView({ block: 'center' }); } catch {}
                await sleep(400);
                const rowRect = listCell.getBoundingClientRect();
                const saveButton = Array.from(dialog.querySelectorAll('[role="button"], button')).find(b => {
                    const txt = (b.innerText || '').trim();
                    return /^(Save|Done|保存|完成|儲存)$/i.test(txt);
                });
                const saveRect = saveButton ? saveButton.getBoundingClientRect() : null;
                return {
                    ok: true,
                    needsNativeInteraction: true,
                    rowClickX: Math.round(rowRect.left + rowRect.width / 2),
                    rowClickY: Math.round(rowRect.top + rowRect.height / 2),
                    saveClickX: saveRect ? Math.round(saveRect.left + saveRect.width / 2) : null,
                    saveClickY: saveRect ? Math.round(saveRect.top + saveRect.height / 2) : null,
                    mutationsBefore: window.__opencliListMutations.length,
                };
            } catch (e) {
                return { ok: false, message: 'UI error: ' + (e?.message || String(e)) };
            }
        })()`);

        if (!uiResult.ok) {
            throw new CommandExecutionError(`Failed to remove @${username} from list ${listId}: ${uiResult.message}`);
        }

        let verifiedBy = null;
        if (uiResult.needsNativeInteraction) {
            if (typeof page.nativeClick !== 'function') {
                throw new CommandExecutionError('Requires up-to-date Chrome extension (nativeClick).');
            }
            if (!uiResult.saveClickX) {
                throw new CommandExecutionError('Save button not found in dialog.');
            }
            const memberCountBefore = Number(targetList.members) || 0;
            await page.nativeClick(uiResult.rowClickX, uiResult.rowClickY);
            await new Promise((r) => setTimeout(r, 800));
            await page.nativeClick(uiResult.saveClickX, uiResult.saveClickY);
            await new Promise((r) => setTimeout(r, 3500));
            const listsAfter = await page.evaluate(`async () => {
                const r = await fetch(${JSON.stringify(listsUrl)}, { headers: ${headers}, credentials: 'include' });
                if (!r.ok) return { __error: 'HTTP ' + r.status };
                return await r.json();
            }`);
            const parsedAfter = listsAfter && !listsAfter.__error
                ? parseListsManagement(listsAfter, new Set())
                : [];
            const afterList = parsedAfter.find((l) => l.id === listId);
            const memberCountAfter = afterList ? Number(afterList.members) || 0 : -1;
            if (memberCountAfter < memberCountBefore) {
                verifiedBy = `member_count ${memberCountBefore} → ${memberCountAfter}`;
            } else {
                throw new CommandExecutionError(`Failed to remove @${username} from list ${listId}: member_count unchanged (${memberCountBefore} → ${memberCountAfter}).`);
            }
        }

        return [{
            listId,
            username,
            userId: String(userId),
            status: uiResult.noop ? 'noop' : 'success',
            message: uiResult.noop
                ? `@${username} was not a member of list ${listId}`
                : `Removed @${username} from list ${listId} (verified via ${verifiedBy})`,
        }];
    },
});
