/**
 * Product Hunt top posts with vote counts — INTERCEPT strategy.
 *
 * Navigates to the Product Hunt homepage and scrapes rendered product cards.
 */
import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import type { IPage } from '../../types.js';

cli({
  site: 'producthunt',
  name: 'hot',
  description: "Today's top Product Hunt launches with vote counts",
  domain: 'www.producthunt.com',
  strategy: Strategy.INTERCEPT,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of results (max 50)' },
  ],
  columns: ['rank', 'name', 'votes', 'url'],
  func: async (page: IPage, args) => {
    const count = Math.min(Number(args.limit) || 20, 50);

    await page.installInterceptor('producthunt.com');
    await page.goto('https://www.producthunt.com');
    await page.wait(5);

    const domItems: any = await page.evaluate(`
      (() => {
        // Vote count elements: <p> with font-semibold containing a pure number
        const voteEls = Array.from(document.querySelectorAll('p')).filter(el => {
          const txt = el.textContent?.trim() || '';
          return /^\\d+$/.test(txt) && parseInt(txt) > 0 && el.className?.includes('font-semibold');
        });

        const seen = new Set();
        const results = [];

        for (const voteEl of voteEls) {
          const votes = voteEl.textContent?.trim() || '';
          // Walk up from vote element to find the closest /products/ link
          let node = voteEl.parentElement;
          let href = null, name = null;
          for (let i = 0; i < 12 && node; i++) {
            // Find all /products/ links and pick the one with the shortest text (= title link)
            const links = Array.from(node.querySelectorAll('a[href^="/products/"]'));
            const titleLink = links.find(a => {
              const txt = a.textContent?.trim() || '';
              return txt.length > 0 && txt.length < 80;
            });
            if (titleLink) {
              href = titleLink.getAttribute('href');
              name = (titleLink.textContent?.trim() || '').replace(/^\\d+\\.\\s*/, '');
              break;
            }
            node = node.parentElement;
          }
          if (!href || !name || seen.has(href)) continue;
          seen.add(href);
          results.push({
            name,
            votes,
            url: 'https://www.producthunt.com' + href,
          });
        }

        return results;
      })()
    `);

    const items = Array.isArray(domItems) ? (domItems as any[]) : [];
    if (items.length === 0) {
      throw new CliError(
        'NO_DATA',
        'Could not retrieve Product Hunt top posts',
        'Product Hunt may have changed its layout',
      );
    }

    // Sort by votes descending and assign ranks
    items.sort((a: any, b: any) => parseInt(b.votes) - parseInt(a.votes));

    return items.slice(0, count).map((item: any, i: number) => ({
      rank: i + 1,
      name: item.name,
      votes: item.votes,
      url: item.url,
    }));
  },
});
