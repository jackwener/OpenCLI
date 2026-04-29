import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

cli({
  site: 'facebook',
  name: 'marketplace-listings',
  description: 'List your Facebook Marketplace seller listings',
  domain: 'www.facebook.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of listings to return' },
  ],
  columns: ['index', 'title', 'price', 'status', 'listed', 'clicks', 'actions'],
  func: async (page, args) => {
    if (!page) throw new CliError('NO_BROWSER', 'Browser session required for facebook marketplace-listings');
    const limit = Math.min(Number(args.limit) || 20, 100);
    await page.goto('https://www.facebook.com/marketplace/you/selling/');
    await page.wait(4);

    const rows = await page.evaluate(String.raw`(() => {
      const clean = (s) => String(s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      const allText = document.body?.innerText || '';
      if (/log in|sign in/i.test(allText) && !/Marketplace/i.test(allText)) return [];

      const lines = allText.split(/\n+/).map(clean).filter(Boolean);
      const seen = new Set();
      const out = [];
      for (let i = 1; i < lines.length; i += 1) {
        if (!/^(?:CA\$|\$)\s*\d+/.test(lines[i])) continue;
        const title = lines[i - 1];
        if (!title || /^(Hide|All listings|Needs attention|Marketplace|Selling)$/i.test(title)) continue;
        if (seen.has(title)) continue;
        seen.add(title);
        const windowLines = lines.slice(i, i + 12);
        const status = windowLines.find((line) => /^(Active|Sold|Pending|Draft)$/i.test(line)) || '';
        const listed = windowLines.find((line) => /Listed on\b/i.test(line))?.replace(/^·\s*/, '') || '';
        const clickLine = windowLines.find((line) => /clicks? on listing/i.test(line)) || '';
        const clickMatch = clickLine.match(/([\d,.]+)\s+clicks? on listing/i);
        const actions = windowLines.filter((line) => /^(Mark as sold|Mark as available|Relist this item|Share|Boost listing)$/i.test(line));
        out.push({
          title,
          price: lines[i],
          status,
          listed,
          clicks: clickMatch ? clickMatch[1] : '',
          actions,
        });
      }
      return out;
    })()`);

    const items = Array.isArray(rows) ? rows : [];
    if (items.length === 0) {
      throw new CliError('NO_DATA', 'Could not find Facebook Marketplace seller listings', 'Check that Chrome is logged into Facebook and Marketplace selling page is available.');
    }
    return items.slice(0, limit).map((item, index) => ({
      index: index + 1,
      title: item.title || '',
      price: item.price || '',
      status: item.status || '',
      listed: item.listed || '',
      clicks: item.clicks || '',
      actions: Array.isArray(item.actions) ? item.actions.join(', ') : String(item.actions || ''),
    }));
  },
});
