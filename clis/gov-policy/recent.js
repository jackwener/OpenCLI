/**
 * gov-policy recent — latest State Council policy releases.
 *
 * Targets www.gov.cn/zhengce/zuixin/index.htm. The listing is rendered
 * server-side into one of `.news_box li`, `.list li`, `.list_item`,
 * `.news-list li` (the page rotates between layouts).
 *
 * The DOM extractor is defined as a top-level function and injected
 * into `page.evaluate` via `.toString()`, so the same code is exercised
 * by a JSDOM-against-frozen-fixture unit test (see gov-policy.test.js).
 */

import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    classifyExtractorFailure,
    parseGovPolicyLimit,
    requireRows,
    wrapBrowserError,
} from './utils.js';

/**
 * Pure DOM extractor for the gov-policy "latest policies" listing page.
 *
 * Uses bare `document` / `location` so it runs identically in:
 *   - the live browser (injected via `${extractRecentRows.toString()}`)
 *   - JSDOM unit tests (which swap `globalThis.document` / `globalThis.location`)
 */
export function extractRecentRows() {
    const normalize = (v) => (v || '').replace(/\s+/g, ' ').trim();
    const items = document.querySelectorAll('.news_box li, .list li, .list_item, .news-list li');
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
        const titleEl = el.querySelector('a');
        const title = normalize(titleEl?.textContent);
        if (!title || title.length < 4) continue;

        let url = titleEl?.getAttribute('href') || '';
        if (url && !url.startsWith('http')) url = 'https://www.gov.cn' + url;

        const date = (el.textContent || '').match(/(\d{4}[-./]\d{1,2}[-./]\d{1,2})/)?.[1] || '';
        const source = normalize(el.querySelector('.source, .from')?.textContent);

        rows.push({ rank: rows.length + 1, title, date, source, url });
    }
    return { ok: true, rows };
}

cli({
    site: 'gov-policy',
    name: 'recent',
    access: 'read',
    description: '国务院最新政策文件',
    domain: 'www.gov.cn',
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'limit', type: 'int', default: 10, help: '返回结果数量 (max 20)' },
    ],
    columns: ['rank', 'title', 'date', 'source', 'url'],
    func: async (page, kwargs) => {
        const limit = parseGovPolicyLimit(kwargs.limit, 'recent');
        try {
            await page.goto('https://www.gov.cn/zhengce/zuixin/index.htm');
            await page.wait(4);
            // Poll until the SSR listing mounts.
            await page.evaluate(`
      (async () => {
        for (let i = 0; i < 20; i++) {
          if (document.querySelector('.news_box li, .list li, .list_item, .news-list li')) break;
          await new Promise(r => setTimeout(r, 500));
        }
      })()
    `);
            const result = await page.evaluate(`(${extractRecentRows.toString()})()`);
            if (!result || !result.ok) classifyExtractorFailure('recent', result);
            return requireRows('recent', result.rows).slice(0, limit);
        } catch (error) {
            wrapBrowserError('recent', error);
        }
    },
});
