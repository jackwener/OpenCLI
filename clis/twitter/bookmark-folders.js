import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { TWITTER_BEARER_TOKEN } from './utils.js';
import { resolveTwitterQueryId } from './shared.js';

// X surfaces user-created bookmark folders through a GraphQL slice query.
// We mirror the patterns used in bookmarks.js / lists.js: a literal
// fallback queryId combined with a runtime lookup against the
// twitter-openapi placeholder.json so we keep working when X rotates IDs.
const OPERATION_NAME = 'bookmarkFoldersSlice';
const FALLBACK_QUERY_ID = 'i78YDd0Tza-dWKw5H2Y7WA';

const FEATURES = {
    rweb_tipjar_consumption_enabled: false,
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
};

function buildUrl(queryId) {
    const variables = JSON.stringify({});
    return `/i/api/graphql/${queryId}/${OPERATION_NAME}`
        + `?variables=${encodeURIComponent(variables)}`
        + `&features=${encodeURIComponent(JSON.stringify(FEATURES))}`;
}

/**
 * Walk the GraphQL response shape used by X's bookmark folders slice and
 * project each folder onto our column row.
 *
 * X has shipped at least three different envelope shapes for this query
 * across the last two years; the precedence order below preserves
 * compatibility with older accounts whose Premium-eligibility flag is
 * still on the legacy V2 envelope.
 *
 * Exported via __test__ so the parser is unit-testable without a browser.
 */
export function parseBookmarkFolders(data, seen) {
    const folders = [];
    const slice = data?.data?.viewer?.bookmark_collections_slice
        || data?.data?.viewer_v2?.user_results?.result?.bookmark_collections_slice
        || data?.data?.bookmark_collections_slice
        || null;
    const items = slice?.items || slice?.timeline?.timeline?.instructions?.flatMap?.(i => i.entries || []) || [];
    for (const item of items) {
        // Two known item shapes: direct {id, name, ...} (newer) or wrapped
        // {content: {bookmarkCollectionResult: {...}}} (older / nested).
        const folder
            = item?.bookmarkCollection
            || item?.content?.bookmarkCollection
            || item?.content?.itemContent?.bookmark_collection
            || item;
        const id = folder?.id_str || folder?.id || folder?.rest_id || '';
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const name = folder?.name || folder?.collection_name || '';
        // bookmarks_count is the X UI label; older envelopes used `count`.
        const itemsCount = Number(folder?.bookmarks_count ?? folder?.items_count ?? folder?.count ?? 0) || 0;
        const createdAt = folder?.created_at || folder?.timestamp_ms || '';
        folders.push({
            id: String(id),
            name: String(name),
            items: itemsCount,
            created_at: String(createdAt),
        });
    }
    return folders;
}

cli({
    site: 'twitter',
    name: 'bookmark-folders',
    access: 'read',
    description: 'List your Twitter/X bookmark folders (the user-created collections under Bookmarks). Returns folder id, name, item count, and created_at.',
    domain: 'x.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [],
    columns: ['id', 'name', 'items', 'created_at'],
    func: async (page) => {
        const cookies = await page.getCookies({ url: 'https://x.com' });
        const ct0 = cookies.find((c) => c.name === 'ct0')?.value || null;
        if (!ct0)
            throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');

        // Try the fa0311/twitter-openapi placeholder first; fall back to scraping
        // client-web bundles for the queryId; final fallback is the pinned constant.
        const queryId = await resolveTwitterQueryId(page, OPERATION_NAME, FALLBACK_QUERY_ID);

        const headers = JSON.stringify({
            'Authorization': `Bearer ${decodeURIComponent(TWITTER_BEARER_TOKEN)}`,
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
            throw new CommandExecutionError(`HTTP ${data.error}: Failed to fetch bookmark folders. queryId may have expired, or your account may not have folder access.`);
        }
        const seen = new Set();
        return parseBookmarkFolders(data, seen);
    },
});

export const __test__ = {
    parseBookmarkFolders,
    buildUrl,
};
