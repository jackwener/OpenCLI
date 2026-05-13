/**
 * Rednote search — international mirror of xiaohongshu/search.
 *
 * Reuses the DOM-extraction IIFE from `../xiaohongshu/search.js`; only the
 * web host and the login-gate detection differ. See issue #1136 for the
 * 1:1 comparison between the two frontends.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError } from '@jackwener/opencli/errors';
import { buildScrollUntilJs, buildSearchExtractJs, noteIdToDate } from '../xiaohongshu/search.js';

function parseLimit(raw) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
        throw new ArgumentError(`--limit must be an integer between 1 and 100, got ${JSON.stringify(raw)}`);
    }
    if (parsed < 1 || parsed > 100) {
        throw new ArgumentError(`--limit must be between 1 and 100, got ${parsed}`);
    }
    return parsed;
}

/**
 * Wait for search results or login wall using MutationObserver (max 5s).
 *
 * Differs from xiaohongshu by detecting a full-screen login modal instead
 * of (and as a fallback, alongside) the inline `登录后查看搜索结果` text.
 * The modal detector filters hidden / zero-area elements to avoid false
 * positives on background dialogs.
 */
const WAIT_FOR_CONTENT_JS = `
  new Promise((resolve) => {
    const hasLoginModal = () => {
      const candidates = document.querySelectorAll(
        '[class*="login-modal"], [class*="LoginModal"], [class*="login-container"], [class*="LoginContainer"], dialog[role="dialog"]'
      );
      for (const el of candidates) {
        if (!(el instanceof HTMLElement)) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        return true;
      }
      return false;
    };
    const detect = () => {
      if (document.querySelector('section.note-item')) return 'content';
      if (/登录后查看搜索结果|请登录/.test(document.body?.innerText || '')) return 'login_wall';
      if (hasLoginModal()) return 'login_wall';
      return null;
    };
    const found = detect();
    if (found) return resolve(found);
    const observer = new MutationObserver(() => {
      const result = detect();
      if (result) { observer.disconnect(); resolve(result); }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { observer.disconnect(); resolve('timeout'); }, 5000);
  })
`;

cli({
    site: 'rednote',
    name: 'search',
    access: 'read',
    description: 'Search rednote notes',
    domain: 'www.rednote.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        { name: 'query', required: true, positional: true, help: 'Search keyword' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
    ],
    columns: ['rank', 'title', 'author', 'likes', 'published_at', 'url', 'author_url'],
    func: async (page, kwargs) => {
        const limit = parseLimit(kwargs.limit ?? 20);
        const keyword = encodeURIComponent(kwargs.query);
        await page.goto(`https://www.rednote.com/search_result?keyword=${keyword}&source=web_search_result_notes`);
        const waitResult = await page.evaluate(WAIT_FOR_CONTENT_JS);
        if (waitResult === 'login_wall') {
            throw new AuthRequiredError('www.rednote.com', 'Rednote search results are blocked behind a login wall');
        }
        // Scroll until enough rows are rendered or the lazy-load plateaus.
        // Same fix as xiaohongshu/search (#1471): the previous fixed
        // `autoScroll({ times: 2 })` capped extraction at ~13 notes regardless
        // of `--limit`.
        await page.evaluate(buildScrollUntilJs(limit));
        const payload = await page.evaluate(buildSearchExtractJs('www.rednote.com'));
        const data = Array.isArray(payload) ? payload : [];
        return data
            .filter((item) => item.title)
            .slice(0, limit)
            .map((item, i) => ({
            rank: i + 1,
            ...item,
            published_at: noteIdToDate(item.url),
        }));
    },
});
