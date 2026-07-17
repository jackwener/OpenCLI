import fs from 'node:fs';
import path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import { extractMedia, describeTwitterApiError } from './shared.js';
import { TWITTER_BEARER_TOKEN, applyTopByEngagement } from './utils.js';
const BOOKMARKS_QUERY_ID = 'Fy0QMy4q_aZCpkO0PnyLYw';
// Safety cap only. Full-archive runs can set a higher page budget via --max-pages.
const DEFAULT_MAX_PAGINATION_PAGES = 100;
const HARD_MAX_PAGINATION_PAGES = 100000;
const FEATURES = {
    rweb_video_screen_enabled: false,
    profile_label_improvements_pcf_label_in_post_enabled: true,
    responsive_web_profile_redirect_enabled: false,
    rweb_tipjar_consumption_enabled: false,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    premium_content_api_read_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    articles_preview_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    content_disclosure_indicator_enabled: true,
    content_disclosure_ai_generated_indicator_enabled: true,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: false,
    responsive_web_enhance_cards_enabled: false,
};
function buildBookmarksUrl(count, cursor) {
    const vars = {
        count,
        includePromotedContent: false,
    };
    if (cursor)
        vars.cursor = cursor;
    return `/i/api/graphql/${BOOKMARKS_QUERY_ID}/Bookmarks`
        + `?variables=${encodeURIComponent(JSON.stringify(vars))}`
        + `&features=${encodeURIComponent(JSON.stringify(FEATURES))}`;
}
export function extractBookmarkTweet(result, seen) {
    if (!result)
        return null;
    const tw = result.tweet || result;
    const legacy = tw.legacy || {};
    if (!tw.rest_id || seen.has(tw.rest_id))
        return null;
    seen.add(tw.rest_id);
    const user = tw.core?.user_results?.result;
    const screenName = user?.legacy?.screen_name || user?.core?.screen_name || 'unknown';
    const displayName = user?.legacy?.name || user?.core?.name || '';
    const noteText = tw.note_tweet?.note_tweet_results?.result?.text;
    return {
        id: tw.rest_id,
        author: screenName,
        name: displayName,
        text: noteText || legacy.full_text || '',
        likes: legacy.favorite_count || 0,
        retweets: legacy.retweet_count || 0,
        bookmarks: legacy.bookmark_count || 0,
        created_at: legacy.created_at || '',
        url: `https://x.com/${screenName}/status/${tw.rest_id}`,
        ...extractMedia(legacy),
    };
}
export function parseBookmarks(data, seen) {
    const tweets = [];
    let nextCursor = null;
    const instructions = data?.data?.bookmark_timeline_v2?.timeline?.instructions
        || data?.data?.bookmark_timeline?.timeline?.instructions
        || [];
    for (const inst of instructions) {
        for (const entry of inst.entries || []) {
            const content = entry.content;
            if (content?.entryType === 'TimelineTimelineCursor' || content?.__typename === 'TimelineTimelineCursor') {
                if (content.cursorType === 'Bottom' || content.cursorType === 'ShowMore')
                    nextCursor = content.value;
                continue;
            }
            if (entry.entryId?.startsWith('cursor-bottom-') || entry.entryId?.startsWith('cursor-showMore-')) {
                nextCursor = content?.value || content?.itemContent?.value || nextCursor;
                continue;
            }
            const direct = extractBookmarkTweet(content?.itemContent?.tweet_results?.result, seen);
            if (direct) {
                tweets.push(direct);
                continue;
            }
            for (const item of content?.items || []) {
                const nested = extractBookmarkTweet(item.item?.itemContent?.tweet_results?.result, seen);
                if (nested)
                    tweets.push(nested);
            }
        }
    }
    return { tweets, nextCursor };
}
function readResumeFile(filePath) {
    if (!filePath || !fs.existsSync(filePath))
        return null;
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return {
            cursor: parsed?.cursor || null,
            count: Number(parsed?.count || 0),
            tweets: Array.isArray(parsed?.tweets) ? parsed.tweets : [],
        };
    }
    catch {
        return null;
    }
}
function ensureParentDir(filePath) {
    if (!filePath)
        return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}
function removeFile(filePath) {
    if (!filePath)
        return;
    try {
        fs.rmSync(filePath, { force: true });
    }
    catch {
    }
}
function loadSeenIdsFromJsonl(filePath) {
    const seen = new Set();
    if (!filePath || !fs.existsSync(filePath))
        return seen;
    const text = fs.readFileSync(filePath, 'utf8');
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        try {
            const row = JSON.parse(trimmed);
            if (row?.id)
                seen.add(String(row.id));
        }
        catch {
        }
    }
    return seen;
}
function appendJsonlRows(filePath, rows) {
    if (!filePath || !Array.isArray(rows) || rows.length === 0)
        return;
    ensureParentDir(filePath);
    // Escape LS/PS so JSONL stays one physical line even when tweet text contains them.
    const text = rows
        .map((row) => JSON.stringify(row).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'))
        .join('\n') + '\n';
    fs.appendFileSync(filePath, text, 'utf8');
}
function writeResumeFile(filePath, payload) {
    if (!filePath)
        return;
    ensureParentDir(filePath);
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n');
}
function removeResumeFile(filePath) {
    removeFile(filePath);
}
function resolveMaxPages(kwargs, fetchAll) {
    const raw = kwargs['max-pages'];
    if (raw === undefined || raw === null || raw === '') {
        return fetchAll ? HARD_MAX_PAGINATION_PAGES : DEFAULT_MAX_PAGINATION_PAGES;
    }
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > HARD_MAX_PAGINATION_PAGES) {
        throw new ArgumentError(`--max-pages must be an integer between 1 and ${HARD_MAX_PAGINATION_PAGES}`);
    }
    return value;
}
cli({
    site: 'twitter',
    name: 'bookmarks',
    access: 'read',
    description: 'Fetch your Twitter/X bookmarks (the logged-in user\'s saved tweets, newest first)',
    domain: 'x.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Maximum number of bookmarks to return (default 20). Ignored when --all is set.' },
        { name: 'all', type: 'bool', default: false, help: 'Fetch all bookmark pages until exhausted. Prefer --output-file for large archives.' },
        { name: 'resume-file', type: 'string', help: 'Resume file for long-running all-pages bookmark syncs.' },
        { name: 'output-file', type: 'string', help: 'Write all-page results to a JSONL file instead of returning one large JSON array.' },
        { name: 'max-pages', type: 'int', help: `Optional pagination safety cap (default ${DEFAULT_MAX_PAGINATION_PAGES}; raised automatically with --all).` },
        { name: 'top-by-engagement', type: 'int', default: 0, help: 'When set to N>0, re-rank the bookmarks by weighted engagement (likes×1 + retweets×3 + replies×2 + bookmarks×5 + log10(views+1)×0.5) and return the top N. Default 0 keeps the API\'s native (saved-time) ordering. Incompatible with --output-file.' },
    ],
    columns: ['id', 'author', 'text', 'likes', 'retweets', 'bookmarks', 'created_at', 'url', 'has_media', 'media_urls', 'media_posters'],
    func: async (page, kwargs) => {
        const fetchAll = Boolean(kwargs.all);
        const limit = fetchAll ? Number.POSITIVE_INFINITY : (kwargs.limit || 20);
        const resumeFile = kwargs['resume-file'] || '';
        const outputFile = kwargs['output-file'] || '';
        const useOutputFile = Boolean(fetchAll && outputFile);
        const maxPages = resolveMaxPages(kwargs, fetchAll);
        const topByEngagement = Number(kwargs['top-by-engagement'] || 0);
        if (useOutputFile && topByEngagement > 0) {
            throw new ArgumentError('--top-by-engagement cannot be combined with --output-file');
        }
        if (outputFile && !fetchAll) {
            throw new ArgumentError('--output-file requires --all');
        }
        const cookies = await page.getCookies({ url: 'https://x.com' });
        const ct0 = cookies.find((c) => c.name === 'ct0')?.value || null;
        if (!ct0)
            throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');
        const queryId = await page.evaluate(`async () => {
      try {
        const ghResp = await fetch('https://raw.githubusercontent.com/fa0311/twitter-openapi/refs/heads/main/src/config/placeholder.json');
        if (ghResp.ok) {
          const data = await ghResp.json();
          const entry = data['Bookmarks'];
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
            const re = /queryId:"([A-Za-z0-9_-]+)"[^}]{0,200}operationName:"Bookmarks"/;
            const m = text.match(re);
            if (m) return m[1];
          } catch {}
        }
      } catch {}
      return null;
    }`) || BOOKMARKS_QUERY_ID;
        const headers = JSON.stringify({
            'Authorization': `Bearer ${decodeURIComponent(TWITTER_BEARER_TOKEN)}`,
            'X-Csrf-Token': ct0,
            'X-Twitter-Auth-Type': 'OAuth2Session',
            'X-Twitter-Active-User': 'yes',
        });
        let resumed = fetchAll ? readResumeFile(resumeFile) : null;
        if (useOutputFile && resumed && !fs.existsSync(outputFile)) {
            removeResumeFile(resumeFile);
            resumed = null;
        }
        if (useOutputFile && !resumed)
            removeFile(outputFile);
        const allTweets = useOutputFile ? [] : (resumed?.tweets ? [...resumed.tweets] : []);
        const seen = useOutputFile
            ? loadSeenIdsFromJsonl(outputFile)
            : new Set(allTweets.map((tweet) => tweet?.id).filter(Boolean));
        let outputCount = useOutputFile
            ? Math.max(seen.size, Number(resumed?.count || 0))
            : 0;
        let cursor = resumed?.cursor || null;
        let pages = 0;
        // Runaway guard only; --limit/--all and cursor exhaustion control normal pagination.
        while (pages < maxPages && (fetchAll || allTweets.length < limit)) {
            pages += 1;
            const currentCount = useOutputFile ? outputCount : allTweets.length;
            const remaining = fetchAll ? 100 : (limit - currentCount + 10);
            const fetchCount = Math.min(100, remaining);
            const apiUrl = buildBookmarksUrl(fetchCount, cursor).replace(BOOKMARKS_QUERY_ID, queryId);
            const data = await page.evaluate(`async () => {
        const r = await fetch(${JSON.stringify(apiUrl)}, { headers: ${headers}, credentials: 'include' });
        return r.ok ? await r.json() : { error: r.status };
      }`);
            if (data?.error) {
                if ((useOutputFile ? outputCount : allTweets.length) === 0)
                    throw new CommandExecutionError(describeTwitterApiError('Bookmarks', data.error));
                break;
            }
            const { tweets, nextCursor } = parseBookmarks(data, seen);
            if (useOutputFile) {
                appendJsonlRows(outputFile, tweets);
                outputCount += tweets.length;
            }
            else {
                allTweets.push(...tweets);
            }
            writeResumeFile(resumeFile, {
                cursor: nextCursor || null,
                count: useOutputFile ? outputCount : allTweets.length,
                tweets: useOutputFile ? undefined : allTweets,
                updatedAt: new Date().toISOString(),
                complete: !nextCursor || nextCursor === cursor,
                source: 'bookmarks',
                outputFile: useOutputFile ? outputFile : null,
            });
            if (!nextCursor || nextCursor === cursor)
                break;
            cursor = nextCursor;
        }
        removeResumeFile(resumeFile);
        if (useOutputFile) {
            return {
                outputFile,
                count: outputCount,
                source: 'bookmarks',
                complete: true,
            };
        }
        const trimmed = fetchAll ? allTweets : allTweets.slice(0, limit);
        return applyTopByEngagement(trimmed, topByEngagement);
    },
});
export const __test__ = {
    parseBookmarks,
    extractBookmarkTweet,
    appendJsonlRows,
};
