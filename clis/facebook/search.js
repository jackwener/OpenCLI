import { ArgumentError, AuthRequiredError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';

const FACEBOOK_HOME = 'https://www.facebook.com';
const MAX_LIMIT = 50;

function requireLimit(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
    throw new ArgumentError(`facebook search --limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  return n;
}

function requireQuery(value) {
  const q = String(value ?? '').trim();
  if (!q) throw new ArgumentError('facebook search requires a non-empty query');
  return q;
}

function unwrapBrowserResult(value) {
  if (value && typeof value === 'object' && 'data' in value) return value.data;
  return value;
}

// The /search/top SPA can take tens of seconds to render its result cards and
// navigation intermittently fails with Chromium's "Navigation rejected." —
// both observed live in #2650. Poll the extraction instead of trusting one
// fixed settle window, and recycle rejected navigation targets the same way
// clis/google/images.js does.
const SEARCH_SETTLE_MS = 8000;
const SEARCH_RENDER_POLL_ATTEMPTS = 15;
const SEARCH_RENDER_POLL_INTERVAL_S = 2;
const SEARCH_EARLY_EXIT_ROW_CAP = 5;

function isNavigationRejected(error) {
  return /Navigation rejected/i.test(String(error?.message || error));
}

/**
 * Navigate, retrying only the recoverable "Navigation rejected." failure:
 * recycle the automation window first, then fall back to a dedicated tab.
 * Any other error propagates unchanged.
 */
async function navigateWithRetry(page, url, options) {
  try {
    await page.goto(url, options);
    return;
  } catch (error) {
    if (!isNavigationRejected(error)) throw error;
  }

  if (typeof page.closeWindow === 'function') {
    await page.closeWindow().catch(() => {});
  }
  try {
    await page.goto(url, options);
    return;
  } catch (error) {
    if (!isNavigationRejected(error)) throw error;
  }

  if (typeof page.newTab === 'function' && typeof page.setActivePage === 'function') {
    const pageId = await page.newTab(url);
    if (pageId) {
      await page.setActivePage(pageId);
      return;
    }
  }
  throw new CommandExecutionError(`facebook search navigation was rejected repeatedly: ${url}`);
}

/**
 * Extract results, re-running the (cheap) in-page extraction until enough
 * rows render or the bounded poll window expires. Early exit at
 * min(limit, SEARCH_EARLY_EXIT_ROW_CAP) keeps the common case at one roundtrip.
 */
async function extractSearchRows(page, limit) {
  const earlyExitAt = limit < SEARCH_EARLY_EXIT_ROW_CAP ? limit : SEARCH_EARLY_EXIT_ROW_CAP;
  let payload;
  for (let attempt = 0; attempt < SEARCH_RENDER_POLL_ATTEMPTS; attempt += 1) {
    payload = unwrapBrowserResult(await page.evaluate(buildSearchExtractScript(limit)));
    if (!payload || typeof payload !== 'object' || !Array.isArray(payload.rows)) return payload;
    if (payload.status === 'auth' || payload.rows.length >= earlyExitAt) return payload;
    if (attempt < SEARCH_RENDER_POLL_ATTEMPTS - 1) {
      await page.sleep(SEARCH_RENDER_POLL_INTERVAL_S);
    }
  }
  return payload;
}

// Modern facebook.com /search/top renders results inside [role="feed"] as
// entity/content links (people, pages, groups, posts) — [role="article"] /
// [role="listitem"] no longer wrap them — and FB seeds scrambled hidden-char
// decoy links back to /search/top. Collect anchors inside the feed, keep only
// real entity/content hrefs, and drop the decoys plus obfuscated text. See #2090.
function buildSearchExtractScript(limit) {
  return `(() => {
    const limit = ${limit};

    function clean(value) {
      return String(value || '')
        .replace(/[\\u200b-\\u200f\\u202a-\\u202e\\u2060\\ufeff]/g, '')
        .replace(/\\s+/g, ' ')
        .trim();
    }

    // FB anti-scrape obfuscation: long spaceless digit tokens and spaced
    // single-char strings ("a b c d e"). Real titles never look like this.
    function isObfuscated(text) {
      if (!text) return true;
      if (/^\\d{8,}$/.test(text)) return true;
      if (/^(?:\\S ){4,}\\S$/.test(text) && text.replace(/\\s/g, '').length <= 12) return true;
      return false;
    }

    function isEntityHref(href) {
      if (!href) return false;
      let u;
      try { u = new URL(href, 'https://www.facebook.com'); } catch (e) { return false; }
      // drop hidden-domain .com spam — real results stay on facebook.com
      if (!/(^|\\.)facebook\\.com$/i.test(u.hostname)) return false;
      // l.facebook.com / lm.facebook.com only wrap outbound links (/l.php?u=…);
      // they are redirect shims, never search entities.
      if (/^lm?\\.facebook\\.com$/i.test(u.hostname)) return false;
      const p = u.pathname;
      if (/^\\/search(\\/|$)/i.test(p)) return false;                  // decoy links back to search (incl. bare /search)
      // chrome / non-result destinations that the catch-all below would keep
      if (/^\\/(login|checkpoint|help|policies|privacy|settings|bookmarks|messages|notifications|marketplace|gaming|friends|requests|saved|me)\\b/i.test(p)) return false;
      return /^\\/(profile\\.php|photo\\.php|groups\\/|events\\/|watch\\/|reel\\/|pages\\/|permalink\\.php|story\\.php|[^/]+\\/posts\\/|[^/]+\\/videos\\/|[A-Za-z0-9.\\-]{2,}\\/?$)/i.test(p);
    }

    // Query-identity destinations (permalink.php?story_fbid=…, story.php,
    // photo.php?fbid=…, watch/?v=…) collapse into a single row when the query is
    // dropped — different posts/videos share the same pathname. Keep the identity
    // params, but only those: FB appends per-render tracking nonces (__cft__,
    // __tn__, ref) that would otherwise defeat dedup by making the same post look
    // unique on every render.
    function entityKey(u) {
      const p = u.pathname.toLowerCase();
      let identityParams = [];
      if (p === '/profile.php') identityParams = ['id'];
      else if (p === '/permalink.php' || p === '/story.php') {
        identityParams = ['story_fbid', 'story_id', 'fbid', 'id'];
      } else if (p === '/photo.php') identityParams = ['fbid', 'id'];
      else if (p === '/watch' || p === '/watch/') identityParams = ['v'];
      const ids = identityParams
        .filter((k) => u.searchParams.has(k))
        .map((k) => k + '=' + u.searchParams.get(k));
      return ids.length ? (u.origin + u.pathname + '?' + ids.join('&')) : (u.origin + u.pathname);
    }

    function isAuthPage() {
      const path = window.location && window.location.pathname ? window.location.pathname : '';
      const body = clean(document.body && document.body.textContent);
      return /^\\/(login|checkpoint)(\\/|$|\\.php)/.test(path)
        || /^(Log in to Facebook|Facebook登录|登录 Facebook)/i.test(body)
        || /You must log in to continue/i.test(body);
    }

    if (isAuthPage()) return { status: 'auth', rows: [], diagnostics: {} };

    const feed = document.querySelector('[role="feed"]')
      || document.querySelector('[role="main"]')
      || document.body;
    const anchors = Array.from(feed.querySelectorAll('a[href]'));
    const seen = new Set();
    const rows = [];
    for (const a of anchors) {
      const rawHref = a.href || a.getAttribute('href') || '';
      if (!isEntityHref(rawHref)) continue;
      let key;
      try { const u = new URL(rawHref, 'https://www.facebook.com'); key = entityKey(u); }
      catch (e) { key = rawHref.split('#')[0]; }
      if (seen.has(key)) continue;

      const title = clean(a.textContent).substring(0, 80);
      if (!title || isObfuscated(title)) continue;

      // climb a few levels for the surrounding card text
      let card = a;
      for (let i = 0; i < 4 && card.parentElement; i += 1) {
        card = card.parentElement;
        if (clean(card.textContent).length > title.length + 20) break;
      }
      const text = clean(card.textContent).substring(0, 150);
      if (isObfuscated(text)) continue;

      seen.add(key);
      rows.push({ index: rows.length + 1, title, text, url: key });
      if (rows.length >= limit) break;
    }

    return {
      status: rows.length ? 'ok' : 'no_rows',
      rows,
      diagnostics: {
        feedFound: !!document.querySelector('[role="feed"]'),
        anchorCount: anchors.length,
        mainTextLength: clean((document.querySelector('[role="main"]') || {}).textContent).length,
      },
    };
  })()`;
}

async function searchFacebook(page, kwargs) {
  const query = requireQuery(kwargs.query);
  const limit = requireLimit(kwargs.limit ?? 10);

  // Navigate home first so the SPA is warm, then to the search results.
  // Regression guard for #625: extraction must run *after* this navigation.
  try {
    await navigateWithRetry(page, FACEBOOK_HOME);
    await navigateWithRetry(page, `https://www.facebook.com/search/top?q=${encodeURIComponent(query)}`, { settleMs: SEARCH_SETTLE_MS });
  } catch (err) {
    throw new CommandExecutionError(
      `Failed to open facebook search: ${err instanceof Error ? err.message : err}`,
      'Check that facebook.com is reachable and the browser extension is connected.',
    );
  }

  let payload;
  try {
    payload = await extractSearchRows(page, limit);
  } catch (err) {
    throw new CommandExecutionError(
      `Failed to read facebook search results: ${err instanceof Error ? err.message : err}`,
      'Facebook may not have rendered or the search markup may have changed.',
    );
  }

  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.rows)) {
    throw new CommandExecutionError('facebook search returned malformed extraction payload');
  }
  if (payload.status === 'auth') {
    throw new AuthRequiredError('www.facebook.com', 'Open Chrome and log in to Facebook before retrying.');
  }
  if (payload.rows.length > 0) return payload.rows;

  const d = payload.diagnostics || {};
  if (d.anchorCount || d.mainTextLength > 200) {
    throw new CommandExecutionError(
      'facebook search page rendered but no entity results could be extracted',
      `Diagnostics: feed=${!!d.feedFound}, anchors=${d.anchorCount || 0}, mainTextLength=${d.mainTextLength || 0}.`,
    );
  }
  throw new EmptyResultError('facebook search', `No Facebook results were visible for "${query}".`);
}

const command = {
  site: 'facebook',
  name: 'search',
  access: 'read',
  description: 'Search Facebook for people, pages, or posts',
  domain: 'www.facebook.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'query', required: true, positional: true, help: 'Search query' },
    { name: 'limit', type: 'int', default: 10, help: 'Number of results' },
  ],
  columns: ['index', 'title', 'text', 'url'],
  func: searchFacebook,
};

cli(command);

export const __test__ = {
  buildSearchExtractScript,
  command,
  searchFacebook,
  requireLimit,
  requireQuery,
};
