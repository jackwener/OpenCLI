/**
 * gov-policy search — Chinese government policy full-text search.
 *
 * Targets sousuo.www.gov.cn. Results are server-rendered into
 * `.basic_result_content .item` cards.
 *
 * The DOM extractor is defined as a top-level function and injected
 * into `page.evaluate` via `.toString()`, so the same code is exercised
 * by a JSDOM-against-frozen-fixture unit test (see gov-policy.test.js).
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import { requireNonEmptyQuery } from '../_shared/common.js';
import {
    classifyExtractorFailure,
    parseGovPolicyLimit,
    requireRows,
    wrapBrowserError,
} from './utils.js';

/**
 * Pure DOM extractor for the gov-policy search-results page.
 *
 * Uses bare `document` / `location` so it runs identically in:
 *   - the live browser (injected via `${extractSearchRows.toString()}`)
 *   - JSDOM unit tests (which swap `globalThis.document` / `globalThis.location`)
 */
export function extractSearchRows() {
    const normalize = (v) => (v || '').replace(/\s+/g, ' ').trim();
    const items = document.querySelectorAll('.basic_result_content .item, .js_basic_result_content .item');
    if (items.length === 0) {
        const body = document.body;
        const sampleText = (body && (body.innerText || body.textContent)) || '';
        return {
            ok: false,
            sample: sampleText.slice(0, 800),
            url: location.href,
        };
    }
    const rows = [];
    for (const el of items) {
        const titleEl = el.querySelector('a.title, .title a, a.log-anchor');
        const title = normalize(titleEl?.textContent).replace(/<[^>]+>/g, '');
        if (!title || title.length < 4) continue;

        let url = titleEl?.getAttribute('href') || '';
        if (url && !url.startsWith('http')) url = 'https://www.gov.cn' + url;

        const description = normalize(el.querySelector('.description')?.textContent).slice(0, 120);
        const date = (el.textContent || '').match(/(\d{4}[-./]\d{1,2}[-./]\d{1,2})/)?.[1] || '';
        rows.push({ rank: rows.length + 1, title, description, date, url });
    }
    return { ok: true, rows };
}

cli({
    site: 'gov-policy',
    name: 'search',
    access: 'read',
    description: '中国政府网政策文件搜索',
    domain: 'sousuo.www.gov.cn',
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'query', positional: true, required: true, help: '搜索关键词' },
        { name: 'limit', type: 'int', default: 10, help: '返回结果数量 (max 20)' },
    ],
    columns: ['rank', 'title', 'description', 'date', 'url'],
    func: async (page, kwargs) => {
        const limit = parseGovPolicyLimit(kwargs.limit, 'search');
        const query = requireNonEmptyQuery(kwargs.query);
        try {
            await page.goto(`https://sousuo.www.gov.cn/sousuo/search.shtml?code=17da70961a7&dataTypeId=107&searchWord=${encodeURIComponent(query)}`);
            await page.wait(5);
            // Poll until the SSR result list mounts.
            await page.evaluate(`
      (async () => {
        for (let i = 0; i < 30; i++) {
          if (document.querySelectorAll('.basic_result_content .item, .js_basic_result_content .item').length > 0) break;
          await new Promise(r => setTimeout(r, 500));
        }
      })()
    `);
            const result = await page.evaluate(`(${extractSearchRows.toString()})()`);
            if (!result || !result.ok) classifyExtractorFailure('search', result);
            return requireRows('search', result.rows).slice(0, limit);
        } catch (error) {
            wrapBrowserError('search', error);
        }
    },
});
