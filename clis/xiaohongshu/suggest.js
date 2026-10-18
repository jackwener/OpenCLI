/**
 * Xiaohongshu search suggestions.
 *
 * The search results page carries two query-expansion surfaces that `search`
 * drops: a refinement tab row under the filter bar (the first, active tab is
 * the base query itself) and one or more "大家都在搜" blocks interleaved with
 * the note cards. Both render identically on the classic `/search_result` and
 * the AI-search `/search_result_ai` layouts, and neither needs any interaction
 * beyond the in-site search that `search` already performs.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { unwrapEvaluateResult } from './shared.js';
import { openSearchResults, parseLimit, waitForSearchContent } from './search.js';

export function buildSuggestExtractJs() {
    return `
      (() => {
        const text = (element) => (element?.textContent || '').replace(/\\s+/g, ' ').trim();
        const visible = (element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };
        const rows = [];
        const seen = new Set();
        const push = (suggestion, type) => {
          if (!suggestion || seen.has(type + '\\u0000' + suggestion)) return;
          seen.add(type + '\\u0000' + suggestion);
          rows.push({ suggestion, type });
        };
        for (const tab of document.querySelectorAll('.tab-scroll-container .content-container .tab')) {
          // The active tab is the base query ("综合"), not a suggestion.
          if (tab.classList.contains('active') || !visible(tab)) continue;
          push(text(tab), 'refinement');
        }
        for (const item of document.querySelectorAll('.query-note-wrapper .query-note-item .item-text')) {
          push(text(item), 'trending');
        }
        return rows;
      })()
    `;
}

function requireSuggestRows(payload) {
    const rows = unwrapEvaluateResult(payload);
    if (!Array.isArray(rows)) {
        throw new CommandExecutionError('Unexpected Xiaohongshu suggest payload shape.');
    }
    for (const row of rows) {
        if (!row || typeof row !== 'object' || typeof row.suggestion !== 'string' || typeof row.type !== 'string') {
            throw new CommandExecutionError('Unexpected Xiaohongshu suggest row shape.');
        }
    }
    return rows;
}

cli({
    site: 'xiaohongshu',
    name: 'suggest',
    access: 'read',
    description: '搜索联想：结果页的细分标签与“大家都在搜”',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        { name: 'query', required: true, positional: true, help: 'Search keyword' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of suggestions' },
    ],
    columns: ['rank', 'suggestion', 'type'],
    func: async (page, kwargs) => {
        try {
            const limit = parseLimit(kwargs.limit);
            await openSearchResults(page, kwargs.query);
            await waitForSearchContent(page);
            const rows = requireSuggestRows(await page.evaluate(buildSuggestExtractJs()));
            if (rows.length === 0) {
                throw new EmptyResultError('xiaohongshu suggest', 'The result page rendered neither refinement tags nor trending queries for this keyword.');
            }
            return rows.slice(0, limit).map((row, index) => ({
                rank: index + 1,
                suggestion: row.suggestion,
                type: row.type,
            }));
        }
        catch (err) {
            if (err instanceof CliError)
                throw err;
            throw new CommandExecutionError(`Xiaohongshu suggest failed: ${err?.message ?? String(err)}`);
        }
    },
});
