import { cli } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';

function unwrapEvaluateResult(payload) {
    if (payload && !Array.isArray(payload) && typeof payload === 'object' && 'session' in payload && 'data' in payload) {
        return payload.data;
    }
    return payload;
}

// Modern facebook.com /search/top renders results inside [role="feed"] as
// entity/content links (people, pages, groups, posts). The old extractor keyed
// on [role="article"]/[role="listitem"], which now wrap left-nav and story
// chrome instead — so it returned notifications/stories/live rows. FB also
// injects scrambled decoy anchors back to /search/ plus hidden-character noise.
// (#2090)
//
// Scoping to [role="feed"] and dropping /search/ decoys is the structural core;
// the obfuscation filters below are conservative and best-effort — verify on a
// live logged-in FB session.
function buildFacebookSearchJs(limit) {
    return `(async () => {
    const limit = ${JSON.stringify(limit)};
    const clean = (t) => (t || '').replace(/\\s+/g, ' ').trim();
    const isObfuscated = (t) => {
      const s = (t || '').trim();
      if (!s) return true;
      if (/\\d{12,}/.test(s.replace(/\\s+/g, ''))) return true; // long spaceless digit token
      if (/^(?:\\S\\s+){3,}\\S$/.test(s)) return true;          // spaced single-character decoy
      return false;
    };
    const out = [];
    const seen = new Set();
    for (const feed of document.querySelectorAll('[role="feed"]')) {
      for (const a of feed.querySelectorAll('a[href]')) {
        if (out.length >= limit) break;
        const raw = a.href || a.getAttribute('href') || '';
        let u;
        try { u = new URL(raw, location.href); } catch { continue; }
        const host = u.hostname.toLowerCase();
        // Real facebook.com entity/content links only — exact hostname match, not
        // a substring (which would admit notfacebook.com) and not subdomains
        // (l.facebook.com / lm.facebook.com are outbound-redirect shims).
        if (host !== 'facebook.com' && host !== 'www.facebook.com') continue;
        if (/^\\/search\\//.test(u.pathname)) continue; // drop /search/ decoys
        // Keep the query for query-identity content URLs (photo.php?fbid=,
        // story.php?, watch/?v=); strip it for vanity/profile paths where it is
        // just tracking noise.
        const needsQuery = /\\.php$/.test(u.pathname) || /^\\/watch\\/?$/.test(u.pathname);
        const url = needsQuery ? (u.origin + u.pathname + u.search) : (u.origin + u.pathname);
        if (seen.has(url)) continue;
        const title = clean(a.textContent).substring(0, 80);
        if (!title || isObfuscated(title)) continue;
        seen.add(url);
        // Use the post card when present; otherwise fall back to the anchor's own
        // text, not a.parentElement — for feed-level links that can be the whole
        // feed, pulling in unrelated results/decoys.
        const container = a.closest('[role="article"]') || a;
        out.push({
          index: out.length + 1,
          title,
          text: clean(container.textContent).substring(0, 150),
          url,
        });
      }
    }
    return out;
  })()`;
}

export const facebookSearchCommand = cli({
    site: 'facebook',
    name: 'search',
    access: 'read',
    description: 'Search Facebook for people, pages, or posts',
    domain: 'www.facebook.com',
    args: [
        { name: 'query', required: true, positional: true, help: 'Search query' },
        { name: 'limit', type: 'int', default: 10, help: 'Number of results' },
    ],
    columns: ['index', 'title', 'text', 'url'],
    func: async (page, kwargs) => {
        const limit = kwargs.limit || 10;
        await page.goto('https://www.facebook.com');
        await page.goto(`https://www.facebook.com/search/top?q=${encodeURIComponent(kwargs.query)}`, { settleMs: 4000 });
        const rows = unwrapEvaluateResult(await page.evaluate(buildFacebookSearchJs(limit)));
        if (!Array.isArray(rows)) {
            throw new CommandExecutionError('facebook search: unexpected extraction payload (expected an array of rows)');
        }
        return rows;
    },
});

export const __test__ = { buildFacebookSearchJs, unwrapEvaluateResult };
