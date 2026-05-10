import { cli, Strategy } from '@jackwener/opencli/registry';
import { AuthRequiredError, EmptyResultError } from '@jackwener/opencli/errors';
// ── CLI definition ────────────────────────────────────────────────────
//
// X (Twitter) removed the post-count caption from each trend cell on the
// /explore/tabs/trending page in 2024-2025. The DOM now only carries:
//   divs[0] = rank + category (e.g. "1 · Trending in United States")
//   divs[1] = topic
//   divs[2..] = caret menu button (no post-count text)
// We previously surfaced a `tweets` column whose value was permanently
// "N/A" on every row — that's silent-wrong data, drop it.
cli({
    site: 'twitter',
    name: 'trending',
    access: 'read',
    description: 'Twitter/X trending topics',
    domain: 'x.com',
    strategy: Strategy.COOKIE,
    browser: true,
    siteSession: 'persistent',
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of trends to show' },
    ],
    columns: ['rank', 'topic', 'category'],
    func: async (page, kwargs) => {
        const limit = kwargs.limit || 20;
        // Navigate to trending page
        await page.goto('https://x.com/explore/tabs/trending');
        await page.wait(3);
        // Verify login via CSRF cookie (read directly from cookie store via CDP)
        const cookies = await page.getCookies({ url: 'https://x.com' });
        const ct0 = cookies.find((c) => c.name === 'ct0')?.value || null;
        if (!ct0)
            throw new AuthRequiredError('x.com', 'Not logged into x.com (no ct0 cookie)');
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
        items.push({ rank: items.length + 1, topic, category });
      });
      return items;
    })()`);
        if (!Array.isArray(trends) || trends.length === 0) {
            throw new EmptyResultError('twitter trending', 'No trends found. The page structure may have changed.');
        }
        return trends.slice(0, limit);
    },
});
