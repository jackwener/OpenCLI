/**
 * 36kr article search — INTERCEPT strategy.
 *
 * Navigates to the 36kr search results page and scrapes rendered articles.
 */
import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import type { IPage } from '../../types.js';

cli({
  site: '36kr',
  name: 'search',
  description: '搜索36氪文章',
  domain: 'www.36kr.com',
  strategy: Strategy.INTERCEPT,
  args: [
    { name: 'query', positional: true, required: true, help: 'Search keyword (e.g. "AI", "OpenAI")' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of results (max 50)' },
  ],
  columns: ['rank', 'title', 'date', 'url'],
  func: async (page: IPage, args) => {
    const count = Math.min(Number(args.limit) || 20, 50);
    const query = encodeURIComponent(String(args.query ?? ''));

    await page.installInterceptor('36kr.com/api');
    await page.goto(`https://www.36kr.com/search/articles/${query}`);
    // waitForCapture times out on 36kr (API intercept fails), poll DOM instead
    const _deadline = Date.now() + 5000;
    while (Date.now() < _deadline && !(await page.evaluate('document.querySelectorAll("a[href*=\"/p/\"]").length'))) await new Promise(r => setTimeout(r, 300));

    const domItems: any = await page.evaluate(`
      (() => {
        const seen = new Set();
        const results = [];
        // article-item-title contains the clickable title link
        const titleEls = document.querySelectorAll('.article-item-title a[href*="/p/"], .article-item-title[href*="/p/"]');
        for (const el of titleEls) {
          const href = el.getAttribute('href') || '';
          const title = el.textContent?.trim() || '';
          if (!title || seen.has(href)) continue;
          seen.add(href);
          // Look for date near the article item
          const item = el.closest('[class*="article-item"]') || el.parentElement;
          const dateEl = item?.querySelector('[class*="time"], [class*="date"], time');
          const date = dateEl?.textContent?.trim() || '';
          results.push({
            title,
            url: href.startsWith('http') ? href : 'https://36kr.com' + href,
            date,
          });
        }
        // Fallback: generic /p/ links with meaningful text
        if (results.length === 0) {
          const links = document.querySelectorAll('a[href*="/p/"]');
          for (const el of links) {
            const href = el.getAttribute('href') || '';
            const title = el.textContent?.trim() || '';
            if (!title || title.length < 8 || seen.has(href) || seen.has(title)) continue;
            seen.add(href);
            seen.add(title);
            results.push({ title, url: href.startsWith('http') ? href : 'https://36kr.com' + href, date: '' });
          }
        }
        return results;
      })()
    `);

    const items = Array.isArray(domItems) ? (domItems as any[]) : [];
    if (items.length === 0) {
      throw new CliError('NO_DATA', 'No results found', `Try a different query or check your keyword`);
    }

    return items.slice(0, count).map((item: any, i: number) => ({
      rank: i + 1,
      title: item.title,
      date: item.date,
      url: item.url,
    }));
  },
});
