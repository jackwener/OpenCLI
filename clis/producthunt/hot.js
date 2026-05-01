/**
 * Product Hunt top posts with vote counts — INTERCEPT strategy.
 *
 * Navigates to the Product Hunt homepage and scrapes rendered product cards.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { pickVoteCount } from './utils.js';
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
    func: async (page, args) => {
        const count = Math.min(Number(args.limit) || 20, 50);
        await page.goto('https://www.producthunt.com');
        await page.wait(3);
        const domItems = await page.evaluate(`
      (() => {
        const seen = new Set();
        const results = [];

        const cardLinks = Array.from(document.querySelectorAll('a[href^="/products/"]')).filter((el) => {
          const href = el.getAttribute('href') || '';
          const text = el.textContent?.trim() || '';
          return href && !href.includes('/reviews') && text.length > 0 && text.length < 120;
        });

        const normalizeName = (text) => text
          .replace(/^\\d+\\.\\s*/, '')
          .replace(/\\s*Launched\\s+this\\s+(month|week|year|day)\\s*/gi, '')
          .replace(/\\s*Featured\\s*/gi, '')
          .trim();

        for (const cardLink of cardLinks) {
          const href = cardLink.getAttribute('href') || '';
          if (!href || seen.has(href)) continue;

          let card = cardLink;
          let node = cardLink.parentElement;
          for (let i = 0; i < 6 && node; i++) {
            const hasReviewLink = !!node.querySelector('a[href="' + href + '/reviews"]');
            const hasNumericNode = Array.from(node.querySelectorAll('button, [role="button"], p, span, div'))
              .some((el) => /^\\d+$/.test(el.textContent?.trim() || ''));
            if (hasReviewLink || hasNumericNode) {
              card = node;
              break;
            }
            node = node.parentElement;
          }

          const name = normalizeName(cardLink.textContent?.trim() || '');
          if (!name) continue;

          const voteCandidates = Array.from(card.querySelectorAll('button, [role="button"], a, p, span, div'))
            .map((el) => {
              const reviewLink = el.closest('a[href="' + href + '/reviews"]');
              return {
                text: el.textContent?.trim() || '',
                tagName: el.tagName,
                className: el.className || '',
                role: el.getAttribute('role') || '',
                inButton: !!el.closest('button, [role="button"]'),
                inReviewLink: !!reviewLink,
              };
            })
            .filter((candidate) => /^\\d+$/.test(candidate.text));

          if (voteCandidates.length === 0) continue;

          seen.add(href);
          results.push({
            name,
            voteCandidates,
            url: 'https://www.producthunt.com' + href,
          });
        }

        return results;
      })()
    `);
        const items = Array.isArray(domItems) ? domItems : [];
        if (items.length === 0) {
            throw new CliError('NO_DATA', 'Could not retrieve Product Hunt top posts', 'Product Hunt may have changed its layout');
        }
        const rankedItems = items
            .map((item) => ({
            name: item.name,
            url: item.url,
            votes: pickVoteCount(Array.isArray(item.voteCandidates) ? item.voteCandidates : []),
        }))
            .filter((item) => item.name && item.url && item.votes);
        if (rankedItems.length === 0) {
            throw new CliError('NO_DATA', 'Could not retrieve Product Hunt vote counts', 'Product Hunt may have changed its vote button structure');
        }
        rankedItems.sort((a, b) => parseInt(b.votes, 10) - parseInt(a.votes, 10));
        return rankedItems.slice(0, count).map((item, i) => ({
            rank: i + 1,
            name: item.name,
            votes: item.votes,
            url: item.url,
        }));
    },
});
