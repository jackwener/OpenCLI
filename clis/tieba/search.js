import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildTiebaSearchItems, normalizeTiebaLimit } from './utils.js';
const MAX_SUPPORTED_PAGE = '1';
/**
 * Extract search result cards from tieba's current desktop search page.
 */
function buildExtractSearchResultsEvaluate(limit) {
    return `
    (async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitFor = async (predicate, timeoutMs = 5000) => {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
          if (predicate()) return true;
          await wait(100);
        }
        return false;
      };
      const getVueProps = (element) => {
        const vue = element && element.__vue__ ? element.__vue__ : null;
        return vue ? (vue._props || vue.$props || {}) : {};
      };
      await waitFor(() => {
        const bodyText = document.body?.innerText || '';
        return Boolean(
          document.querySelector('.threadcardclass.thread-new3.index-feed-cards')
          || document.querySelector('.search-no-result, .search-nodata, .no-result')
          || /百度安全验证|安全验证|请完成验证/.test(bodyText)
        );
      });
      const items = document.querySelectorAll('.threadcardclass.thread-new3.index-feed-cards');
      return Array.from(items).slice(0, ${limit}).map((item) => {
        const forum = item.querySelector('.forum-name-text, .forum-name')?.textContent?.trim() || '';
        const meta = item.querySelector('.user-forum-info')?.textContent?.replace(/\\s+/g, ' ').trim() || '';
        const metaWithoutForum = forum && meta.startsWith(forum)
          ? meta.slice(forum.length).trim()
          : meta;
        const metaMatch = metaWithoutForum.match(/^(.*?)\\s*发布于\\s*(.+)$/);
        const actionBar = item.querySelector('.action-bar-container.search-action-bar');
        const businessInfo = getVueProps(actionBar).businessInfo || {};
        const href = item.querySelector('a[href*="/p/"]')?.href || '';
        const threadId = String(businessInfo.thread_id || '').trim();
        const title = item.querySelector('.title-wrap')?.textContent?.trim()
          || item.querySelector('.title-content-wrap')?.textContent?.trim()
          || '';
        const snippet = item.querySelector('.title-content-wrap')?.textContent?.trim()
          || item.querySelector('.abstract-wrap')?.textContent?.trim()
          || '';

        return {
          title,
          forum,
          author: metaMatch ? metaMatch[1].trim() : metaWithoutForum,
          time: metaMatch ? metaMatch[2].trim() : '',
          snippet: snippet.substring(0, 200),
          id: threadId,
          url: href || (threadId ? 'https://tieba.baidu.com/p/' + threadId : ''),
        };
      }).filter((item) => item.title);
    })()
  `;
}
/**
 * Normalize CLI args into the concrete search page URL.
 */
function getSearchUrl(kwargs) {
    const keyword = String(kwargs.keyword || '');
    const pageNumber = Number(kwargs.page || 1);
    return `https://tieba.baidu.com/f/search/res?qw=${encodeURIComponent(keyword)}&ie=utf-8&pn=${pageNumber}`;
}
/**
 * Tieba's current desktop search UI no longer exposes a reliable browser-page transition.
 */
function assertSupportedPage(kwargs) {
    const pageNumber = String(kwargs.page || 1);
    if (pageNumber === MAX_SUPPORTED_PAGE)
        return;
    throw new ArgumentError(`tieba search currently only supports --page ${MAX_SUPPORTED_PAGE}`, `Baidu Tieba search no longer exposes stable browser pagination; omit --page or use --page ${MAX_SUPPORTED_PAGE}`);
}
cli({
    site: 'tieba',
    name: 'search',
    access: 'read',
    description: 'Search posts across tieba',
    domain: 'tieba.baidu.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'keyword', positional: true, required: true, type: 'string', help: 'Search keyword' },
        // Restrict unsupported pages before the browser session starts.
        { name: 'page', type: 'int', default: 1, choices: ['1'], help: 'Page number (currently only 1 is supported)' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of items to return' },
    ],
    columns: ['rank', 'id', 'title', 'forum', 'author', 'time', 'url'],
    func: async (page, kwargs) => {
        assertSupportedPage(kwargs);
        const limit = normalizeTiebaLimit(kwargs.limit);
        // Use the default browser settle path so we do not read a stale page.
        await page.goto(getSearchUrl(kwargs));
        const raw = await page.evaluate(buildExtractSearchResultsEvaluate(limit));
        const items = buildTiebaSearchItems(Array.isArray(raw) ? raw : [], limit);
        if (!items.length) {
            throw new EmptyResultError('tieba search', 'Tieba may have blocked the result page, or the DOM structure may have changed');
        }
        return items;
    },
});
