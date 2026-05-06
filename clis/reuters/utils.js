/**
 * Shared helpers for the reuters adapter.
 */
import { ArgumentError } from '@jackwener/opencli/errors';

const MIN_LIMIT = 1;
const MAX_LIMIT = 40;

export function parseLimit(raw, fallback = 10) {
    if (raw === undefined || raw === null || raw === '') return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        throw new ArgumentError(`--limit must be an integer between ${MIN_LIMIT} and ${MAX_LIMIT}, got ${JSON.stringify(raw)}`);
    }
    if (parsed < MIN_LIMIT || parsed > MAX_LIMIT) {
        throw new ArgumentError(`--limit must be between ${MIN_LIMIT} and ${MAX_LIMIT}, got ${parsed}`);
    }
    return parsed;
}

/**
 * Build the in-page IIFE that fetches the Reuters search API.
 *
 * Returns a raw envelope `{ ok, status, body, error? }` so that error-handling
 * lives in node space (not silently swallowed by `catch(e) {}` inside the
 * browser).
 */
export function buildSearchScript(query, count) {
    return `
    (async () => {
      const apiQuery = JSON.stringify({
        keyword: ${JSON.stringify(query)},
        offset: 0,
        orderby: 'display_date:desc',
        size: ${count},
        website: 'reuters'
      });
      const apiUrl = 'https://www.reuters.com/pf/api/v3/content/fetch/articles-by-search-v2?query=' + encodeURIComponent(apiQuery);
      try {
        const resp = await fetch(apiUrl, { credentials: 'include' });
        const status = resp.status;
        const statusText = resp.statusText || '';
        const text = await resp.text();
        let body = null;
        let parseError = null;
        if ((text || '').trim()) {
          try { body = JSON.parse(text); } catch (e) { parseError = String((e && e.message) || e); }
        }
        return { ok: resp.ok, status, statusText, body, parseError, textPreview: (text || '').slice(0, 500) };
      } catch (e) {
        return { ok: false, status: 0, body: null, error: String((e && e.message) || e) };
      }
    })()
  `;
}

/**
 * In-page IIFE that walks the Reuters article page DOM and surfaces
 * canonical metadata + body text. Returns a raw `{ ok, body, error? }`
 * envelope so node-side handling can throw typed errors.
 */
export function buildArticleDetailScript() {
    return `
    (() => {
      try {
        const pageText = document.body ? (document.body.innerText || '') : '';
        const authRequired = ${looksAuthWallText.toString()}([
          window.location.href || '',
          document.title || '',
          pageText.slice(0, 4000),
        ].join('\\n')) || Boolean(document.querySelector('[data-testid*="paywall" i], [class*="paywall" i], [id*="paywall" i], [data-testid*="captcha" i], [class*="captcha" i]'));
        const meta = document.getElementById('fusion-metadata');
        let fusion = null;
        if (meta) {
          try { fusion = JSON.parse(meta.textContent || '{}'); } catch (e) { fusion = null; }
        }
        const article = fusion?.globalContent || null;
        const paragraphs = Array.from(document.querySelectorAll('article [data-testid^="paragraph-"], article p'))
          .map((p) => (p.textContent || '').trim())
          .filter(Boolean);
        const bodyText = paragraphs.length ? paragraphs.join('\\n\\n') : ((document.querySelector('article')?.innerText || '').trim() || null);
        return { ok: true, authRequired, body: { article, bodyText } };
      } catch (e) {
        return { ok: false, error: String((e && e.message) || e) };
      }
    })()
  `;
}

export function isAuthStatus(status) {
    return Number(status) === 401 || Number(status) === 403;
}

export function looksAuthWallText(value) {
    const text = String(value ?? '').toLowerCase();
    return /datadome|captcha|verify you are human|human verification|access to this page has been denied|unusual traffic|subscribe to continue|subscription required|sign in to (continue|read|access)|log in to (continue|read|access)/.test(text);
}

function pickAuthors(a) {
    if (!Array.isArray(a)) return null;
    const names = a
        .map((au) => (typeof au === 'string' ? au : au?.name || au?.byline || ''))
        .map((s) => String(s).trim())
        .filter(Boolean);
    return names.length ? names.join(', ') : null;
}

function trimOrNull(v) {
    const s = String(v ?? '').trim();
    return s ? s : null;
}

function dateOnly(v) {
    const s = String(v ?? '').trim();
    if (!s) return null;
    return s.split('T')[0];
}

function articleUrl(canonical) {
    if (!canonical) return null;
    const c = String(canonical);
    if (/^https?:\/\//i.test(c)) return c;
    return 'https://www.reuters.com' + c;
}

export function mapSearchArticles(body, limit) {
    const articles = body?.result?.articles || body?.articles || [];
    if (!Array.isArray(articles)) return [];
    return articles
        .filter((a) => a && typeof a === 'object')
        .slice(0, limit)
        .map((a, i) => ({
            rank: i + 1,
            title: trimOrNull(a.title || a.headlines?.basic),
            date: dateOnly(a.display_date || a.published_time),
            section: trimOrNull(a.taxonomy?.section?.name),
            section_path: trimOrNull(a.taxonomy?.section?.path),
            authors: pickAuthors(a.authors),
            url: articleUrl(a.canonical_url),
        }))
        .filter((row) => row.title && row.url);
}

export function mapArticleDetail(article, bodyText, fallbackUrl = null) {
    if (!article && !bodyText) return null;
    return {
        title: trimOrNull(article?.title || article?.headlines?.basic),
        date: dateOnly(article?.display_date || article?.published_time),
        section: trimOrNull(article?.taxonomy?.section?.name),
        section_path: trimOrNull(article?.taxonomy?.section?.path),
        authors: pickAuthors(article?.authors),
        description: trimOrNull(article?.description?.basic || article?.subheadlines?.basic),
        word_count: Number.isFinite(article?.word_count) ? article.word_count : null,
        url: articleUrl(article?.canonical_url) || trimOrNull(fallbackUrl),
        body: trimOrNull(bodyText),
    };
}

export const __test__ = { MIN_LIMIT, MAX_LIMIT };
