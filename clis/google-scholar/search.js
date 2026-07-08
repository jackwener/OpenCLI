import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { clampInt, requireNonEmptyQuery } from '../_shared/common.js';

cli({
    site: 'google-scholar',
    name: 'search',
    access: 'read',
    description: 'Google Scholar 学术搜索',
    domain: 'scholar.google.com',
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'query', positional: true, required: true, help: '搜索关键词' },
        { name: 'limit', type: 'int', default: 10, help: '返回结果数量 (max 20)' },
    ],
    columns: ['rank', 'title', 'authors', 'source', 'year', 'cited', 'url'],
    func: async (page, kwargs) => {
        const limit = clampInt(kwargs.limit, 10, 1, 20);
        const query = requireNonEmptyQuery(kwargs.query);
        await page.goto(`https://scholar.google.com/scholar?q=${encodeURIComponent(query)}&hl=zh-CN`);
        try {
            await page.wait({ selector: '.gs_r.gs_or.gs_scl', timeout: 5 });
        } catch {
            await page.wait(3);
        }
        const wrapper = await page.evaluate(`
      (() => {
        const normalize = v => (v || '').replace(/\\s+/g, ' ').trim();
        const results = [];
        const resultCards = Array.from(document.querySelectorAll('.gs_r.gs_or.gs_scl'));
        for (const el of resultCards) {
          const container = el.querySelector('.gs_ri') || el;
          const titleEl = container.querySelector('.gs_rt a, h3 a');
          const title = normalize(titleEl?.textContent);
          if (!title) continue;

          const url = titleEl?.getAttribute('href') || '';
          const infoLine = normalize(container.querySelector('.gs_a')?.textContent);
          const parts = infoLine.split(' - ');
          const authors = (parts[0] || '').trim();
          const sourceParts = (parts[1] || '').split(',');
          const source = sourceParts.slice(0, -1).join(',').trim() || sourceParts[0]?.trim() || '';
          const year = infoLine.match(/(19|20)\\d{2}/)?.[0] || '';
          const citedText = normalize(container.querySelector('.gs_fl a[href*="cites"]')?.textContent);
          const cited = citedText.match(/(\\d+)/)?.[1] || '0';

          results.push({
            rank: results.length + 1,
            title,
            authors: authors.slice(0, 80),
            source: source.slice(0, 60),
            year,
            cited,
            url,
          });
          if (results.length >= ${limit}) break;
        }
        return { items: results, resultCount: resultCards.length };
      })()
    `);
        if (!wrapper || typeof wrapper !== 'object' || !Array.isArray(wrapper.items)) {
            throw new CommandExecutionError('Google Scholar search returned an unexpected payload shape');
        }
        if (wrapper.items.length === 0) {
            if (Number(wrapper.resultCount) > 0) {
                throw new CommandExecutionError('Google Scholar result cards were present but no rows could be extracted');
            }
            throw new EmptyResultError('google-scholar/search', 'Try a different query or check whether Google Scholar returned a CAPTCHA.');
        }
        return wrapper.items;
    },
});
