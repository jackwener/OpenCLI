import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { extractMedia } from './shared.js';
import { applyTopByEngagement } from './utils.js';

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

/**
 * Trigger Twitter search SPA navigation with fallback strategies.
 *
 * Primary: pushState + popstate (works in most environments).
 * Fallback: Type into the search input and press Enter when pushState fails
 *   intermittently (e.g. due to Twitter A/B tests or timing races — see #690).
 *
 * Both strategies preserve the JS context so the fetch interceptor stays alive.
 *
 * @param {object} page
 * @param {string} query  — final composed query (already merged with operators)
 * @param {string} fParam — Twitter URL `f=` value (top|live|image|video)
 */
async function navigateToSearch(page, query, fParam) {
    const searchUrl = JSON.stringify(`/search?q=${encodeURIComponent(query)}&f=${fParam}`);
    let lastPath = '';
    // Strategy 1 (primary): pushState + popstate with retry
    for (let attempt = 1; attempt <= 2; attempt++) {
        await page.evaluate(`
      (() => {
        window.history.pushState({}, '', ${searchUrl});
        window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
      })()
    `);
        try {
            await page.wait({ selector: '[data-testid="primaryColumn"]' });
        }
        catch {
            // selector timeout — fall through to path check or next attempt
        }
        lastPath = String(await page.evaluate('() => window.location.pathname') || '');
        if (lastPath.startsWith('/search')) {
            return;
        }
        if (attempt < 2) {
            await page.wait(1);
        }
    }
    // Strategy 2 (fallback): Use the search input on /explore.
    // The nativeSetter + Enter approach triggers Twitter's own form handler,
    // performing SPA navigation without a full page reload.
    const queryStr = JSON.stringify(query);
    const navResult = await page.evaluate(`(async () => {
    try {
      const input = document.querySelector('[data-testid="SearchBox_Search_Input"]');
      if (!input) return { ok: false };

      input.focus();
      await new Promise(r => setTimeout(r, 300));

      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, 'value'
      )?.set;
      if (!nativeSetter) return { ok: false };
      nativeSetter.call(input, ${queryStr});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(r => setTimeout(r, 500));

      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true
      }));

      return { ok: true };
    } catch {
      return { ok: false };
    }
  })()`);
    if (navResult?.ok) {
        try {
            await page.wait({ selector: '[data-testid="primaryColumn"]' });
        }
        catch {
            // fall through to path check
        }
        lastPath = String(await page.evaluate('() => window.location.pathname') || '');
        if (lastPath.startsWith('/search')) {
            // The fallback path doesn't carry the f= URL param, so click the
            // matching tab to align with the requested product. Only `live`
            // currently surfaces a distinct tab label — `image`/`video` tabs
            // also need an explicit click, so try them all.
            const tabClicked = await clickProductTabIfNeeded(page, fParam);
            if (!tabClicked) {
                throw new CommandExecutionError(`SPA fallback reached /search but could not select the requested product tab: ${fParam}`);
            }
            return;
        }
    }
    throw new CommandExecutionError(`SPA navigation to /search failed. Final path: ${lastPath || '(empty)'}. Twitter may have changed its routing.`);
}

/**
 * After the search-input fallback lands on /search, the f= param is missing
 * from the URL. Click the matching tab in the result page header so the
 * SearchTimeline call uses the right filter. No-op for fParam=top (default).
 */
async function clickProductTabIfNeeded(page, fParam) {
    if (fParam === 'top') return true;
    const tabLabels = JSON.stringify({
        live: ['Latest', '最新'],
        image: ['Photos', 'Images', '照片', '图片'],
        video: ['Videos', '视频'],
    }[fParam] || []);
    if (tabLabels === '[]') return true;
    const clicked = await page.evaluate(`(() => {
      const labels = ${tabLabels};
      const tabs = document.querySelectorAll('[role="tab"]');
      for (const tab of tabs) {
        const txt = (tab.textContent || '').trim();
        if (labels.some(l => txt.includes(l))) {
          tab.click();
          return true;
        }
      }
      return false;
    })()`);
    if (!clicked) return false;
    await page.wait(2);
    return true;
}

cli({
    site: 'twitter',
    name: 'search',
    access: 'read',
    description: 'Search Twitter/X for tweets, with optional --from / --has / --exclude / --product filters mapped to X\'s search operators',
    domain: 'x.com',
    strategy: Strategy.INTERCEPT, // Use intercept strategy
    browser: true,
    siteSession: 'persistent',
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
        const fParam = resolveSearchFParam(kwargs);
        // 1. Navigate to x.com/explore (has a search input at the top)
        await page.goto('https://x.com/explore');
        await page.wait(3);
        // 2. Install interceptor BEFORE triggering search.
        //    SPA navigation preserves the JS context, so the monkey-patched
        //    fetch will capture the SearchTimeline API call.
        await page.installInterceptor('SearchTimeline');
        // 3. Trigger SPA navigation to search results via history API.
        //    pushState + popstate triggers React Router's listener without
        //    a full page reload, so the interceptor stays alive.
        //    Note: the previous approach (nativeSetter + Enter keydown on the
        //    search input) does not reliably trigger Twitter's form submission.
        await navigateToSearch(page, finalQuery, fParam);
        // 4. Scroll to trigger additional pagination
        await page.autoScroll({ times: 3, delayMs: 2000 });
        // 5. Retrieve captured data
        const requests = await page.getInterceptedRequests();
        if (!requests || requests.length === 0)
            return [];
        let results = [];
        const seen = new Set();
        for (const req of requests) {
            try {
                const insts = req?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions || [];
                const addEntries = insts.find((i) => i.type === 'TimelineAddEntries')
                    || insts.find((i) => i.entries && Array.isArray(i.entries));
                if (!addEntries?.entries)
                    continue;
                for (const entry of addEntries.entries) {
                    if (!entry.entryId.startsWith('tweet-'))
                        continue;
                    let tweet = entry.content?.itemContent?.tweet_results?.result;
                    if (!tweet)
                        continue;
                    // Handle retweet wrapping
                    if (tweet.__typename === 'TweetWithVisibilityResults' && tweet.tweet) {
                        tweet = tweet.tweet;
                    }
                    if (!tweet.rest_id || seen.has(tweet.rest_id))
                        continue;
                    seen.add(tweet.rest_id);
                    // Twitter moved screen_name from legacy to core
                    const tweetUser = tweet.core?.user_results?.result;
                    results.push({
                        id: tweet.rest_id,
                        author: tweetUser?.core?.screen_name || tweetUser?.legacy?.screen_name || 'unknown',
                        text: tweet.note_tweet?.note_tweet_results?.result?.text || tweet.legacy?.full_text || '',
                        created_at: tweet.legacy?.created_at || '',
                        likes: tweet.legacy?.favorite_count || 0,
                        views: tweet.views?.count || '0',
                        url: `https://x.com/i/status/${tweet.rest_id}`,
                        ...extractMedia(tweet.legacy),
                    });
                }
            }
            catch (e) {
                // ignore parsing errors for individual payloads
            }
        }
        const trimmed = results.slice(0, kwargs.limit);
        return applyTopByEngagement(trimmed, kwargs['top-by-engagement']);
    }
});

export const __test__ = {
    buildSearchQuery,
    resolveSearchFParam,
    HAS_CHOICES,
    EXCLUDE_CHOICES,
    PRODUCT_CHOICES,
    EXCLUDE_TO_OPERATOR,
    PRODUCT_TO_F_PARAM,
    FROM_USER_PATTERN,
};
