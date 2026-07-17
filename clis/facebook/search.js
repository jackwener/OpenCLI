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
      const p = u.pathname;
      if (/^\\/search(\\/|$)/i.test(p)) return false;                  // decoy links back to search (incl. bare /search)
      // chrome / non-result destinations that the catch-all below would keep
      if (/^\\/(login|checkpoint|help|policies|privacy|settings|bookmarks|messages|notifications|marketplace|gaming|friends|requests|saved|me)\\b/i.test(p)) return false;
      return /^\\/(profile\\.php|groups\\/|events\\/|watch\\/|reel\\/|pages\\/|permalink\\.php|story\\.php|[^/]+\\/posts\\/|[^/]+\\/videos\\/|[A-Za-z0-9.\\-]{2,}\\/?$)/i.test(p);
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
      try { const u = new URL(rawHref, 'https://www.facebook.com'); key = u.origin + u.pathname; }
      catch (e) { key = rawHref.split('?')[0].split('#')[0]; }
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
    await page.goto(FACEBOOK_HOME);
    await page.goto(`https://www.facebook.com/search/top?q=${encodeURIComponent(query)}`, { settleMs: 4000 });
  } catch (err) {
    throw new CommandExecutionError(
      `Failed to open facebook search: ${err instanceof Error ? err.message : err}`,
      'Check that facebook.com is reachable and the browser extension is connected.',
    );
  }

  let payload;
  try {
    payload = unwrapBrowserResult(await page.evaluate(buildSearchExtractScript(limit)));
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
