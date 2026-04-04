import { cli, Strategy } from '../../src/registry.js';
import { AuthRequiredError, EmptyResultError } from '../../src/errors.js';

// ── CLI definition ────────────────────────────────────────────────────

cli({
  site: 'twitter',
  name: 'trending',
  description: 'Twitter/X trending topics',
  domain: 'x.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of trends to show' },
  ],
  columns: ['rank', 'topic', 'tweets', 'category'],
  func: async (page, kwargs) => {
    const limit = kwargs.limit || 20;

    // Navigate to trending page
    await page.goto('https://x.com/explore/tabs/trending');
    await page.wait(3);

    // Verify login via CSRF cookie
    const ct0 = await page.evaluate(`(() => {
      return document.cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith('ct0='))?.split('=')[1] || null;
    })()`);
    if (!ct0) throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');

    // Scrape trends from DOM (consistent with what the user sees on the page)
    // DOM children: [0] rank + category, [1] topic, optional post count,
    // and a caret menu button identified by [data-testid="caret"].
    await page.wait(2);
    const trends = await page.evaluate(`(() => {
      const items = [];
      const cells = document.querySelectorAll('[data-testid="trend"]');
      cells.forEach((cell) => {
        const text = cell.textContent || '';
        if (text.includes('Promoted')) return;
        const container = cell.querySelector(':scope > div');
        if (!container) return;
        const divs = container.children;
        if (divs.length < 2) return;
        const topic = divs[1].textContent.trim();
        if (!topic) return;
        const catText = divs[0].textContent.trim();
        const category = catText.replace(/^\\d+\\s*/, '').replace(/^\\xB7\\s*/, '').trim();
        // Find post count: skip rank, topic, and the caret menu button
        let tweets = 'N/A';
        for (let j = 2; j < divs.length; j++) {
          if (divs[j].matches('[data-testid="caret"]') || divs[j].querySelector('[data-testid="caret"]')) continue;
          const t = divs[j].textContent.trim();
          if (t && /\\d/.test(t)) { tweets = t; break; }
        }
        items.push({ rank: items.length + 1, topic, tweets, category });
      });
      return items;
    })()`);

    if (!Array.isArray(trends) || trends.length === 0) {
      throw new EmptyResultError('twitter trending', 'No trends found. The page structure may have changed.');
    }

    return trends.slice(0, limit);
  },
});
