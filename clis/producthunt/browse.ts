/**
 * Product Hunt category browse — INTERCEPT strategy.
 *
 * Navigates to a Product Hunt category page and scrapes the top-rated products.
 * Shows all-time best products for a category (ranked by review score, not daily votes).
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import type { IPage } from '@jackwener/opencli/types';
import { PRODUCTHUNT_CATEGORY_SLUGS } from './utils.js';

cli({
  site: 'producthunt',
  name: 'browse',
  description: 'Best products in a Product Hunt category',
  domain: 'www.producthunt.com',
  strategy: Strategy.INTERCEPT,
  args: [
    {
      name: 'category',
      type: 'string',
      positional: true,
      required: true,
      help: `Category slug, e.g. vibe-coding, ai-agents, developer-tools`,
    },
    { name: 'limit', type: 'int', default: 20, help: 'Number of results (max 50)' },
  ],
  columns: ['rank', 'name', 'tagline', 'reviews', 'url'],
  func: async (page: IPage, args) => {
    const count = Math.min(Number(args.limit) || 20, 50);
    const slug = String(args.category || '').trim().toLowerCase();

    await page.installInterceptor('producthunt.com');
    await page.goto(`https://www.producthunt.com/categories/${slug}`);
    await page.waitForCapture(5);

    const domItems: any = await page.evaluate(`
      (() => {
        const seen = new Set();
        const results = [];

        // Card links: <a class="...flex-col" href="/products/<slug>"> (not review links)
        const cardLinks = Array.from(document.querySelectorAll('a[href^="/products/"]')).filter(a => {
          const href = a.getAttribute('href') || '';
          const cls = a.className || '';
          return cls.includes('flex-col') && !href.includes('/reviews');
        });

        for (const cardLink of cardLinks) {
          const href = cardLink.getAttribute('href');
          if (!href || seen.has(href)) continue;

          // Child 0: div with name (strip "Launched this month/week/year" noise)
          const nameDiv = cardLink.querySelector('div');
          const rawName = nameDiv?.textContent?.trim() || '';
          const name = rawName
            .replace(/\\s*Launched\\s+this\\s+(month|week|year|day)\\s*/gi, '')
            .replace(/\\s*Featured\\s*/gi, '')
            .trim();

          // Child 1: span.text-secondary — tagline
          const taglineEl = cardLink.querySelector('span.text-secondary, span[class*="text-secondary"]');
          const tagline = taglineEl?.textContent?.trim() || '';

          if (!name) continue;

          // Find reviews count from sibling /reviews link
          let reviews = '';
          let container = cardLink.parentElement;
          for (let i = 0; i < 5 && container; i++) {
            const reviewLink = container.querySelector('a[href="' + href + '/reviews"]');
            if (reviewLink) {
              reviews = (reviewLink.textContent?.trim() || '').replace(/\\s*reviews?\\s*/i, '').trim();
              break;
            }
            container = container.parentElement;
          }

          seen.add(href);
          results.push({
            name,
            tagline: tagline.slice(0, 120),
            reviews: reviews || '0',
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
        `No products found for category "${slug}"`,
        'Check the category slug or try: ' + PRODUCTHUNT_CATEGORY_SLUGS.slice(0, 5).join(', '),
      );
    }

    return items.slice(0, count).map((item: any, i: number) => ({
      rank: i + 1,
      name: item.name,
      tagline: item.tagline,
      reviews: item.reviews,
      url: item.url,
    }));
  },
});
