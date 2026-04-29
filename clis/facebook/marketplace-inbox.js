import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';

cli({
  site: 'facebook',
  name: 'marketplace-inbox',
  description: 'List recent Facebook Marketplace buyer/seller conversations',
  domain: 'www.facebook.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of conversations to return' },
  ],
  columns: ['index', 'buyer', 'listing', 'snippet', 'time', 'unread'],
  func: async (page, args) => {
    if (!page) throw new CliError('NO_BROWSER', 'Browser session required for facebook marketplace-inbox');
    const limit = Math.min(Number(args.limit) || 20, 100);
    await page.goto('https://www.facebook.com/marketplace/inbox/');
    await page.wait(4);

    const rows = await page.evaluate(String.raw`(() => {
      const clean = (s) => String(s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
      const timeRe = /^(?:\d{1,2}:\d{2}\s?(?:AM|PM|am|pm|上午|下午)?|Mon|Tue|Wed|Thu|Fri|Sat|Sun|Today|Yesterday|\d+[mhdw]|\d+\s*(?:min|h|d|w))$/;
      const text = document.body?.innerText || '';
      if (/log in|sign in/i.test(text) && !/Marketplace/i.test(text)) return [];

      const lines = text.split(/\n+/).map(clean).filter(Boolean);
      const out = [];
      const seen = new Set();
      const skipBuyer = /^(Marketplace|Browse all|Notifications|Inbox|Marketplace access|Buying|Selling|Create new listing|Create multiple listings|Location|Categories|Vehicles|Property Rentals|All|Pending payment|Paid|To be shipped|Shipped|Cash on delivery|Completed|Filter by label)$/i;
      for (let i = 0; i < lines.length - 2; i += 1) {
        const buyer = lines[i];
        const meta = lines[i + 1];
        if (skipBuyer.test(buyer) || !/^·\s+/.test(meta)) continue;
        const listing = meta.replace(/^·\s*/, '');
        if (!listing || /^Within\b/i.test(listing)) continue;
        const snippet = lines[i + 2] || '';
        const time = timeRe.test(lines[i + 3] || '') ? lines[i + 3] : '';
        const key = buyer + '|' + listing;
        if (seen.has(key)) continue;
        seen.add(key);
        const nearby = lines.slice(Math.max(0, i - 2), i + 5).join(' ');
        out.push({
          buyer,
          listing,
          snippet,
          time,
          unread: /Unread/i.test(nearby),
        });
      }
      return out;
    })()`);

    const items = Array.isArray(rows) ? rows : [];
    if (items.length === 0) {
      throw new CliError('NO_DATA', 'Could not find Facebook Marketplace inbox conversations', 'Check that Chrome is logged into Facebook and Marketplace inbox is available.');
    }
    return items.slice(0, limit).map((item, index) => ({
      index: index + 1,
      buyer: item.buyer || '',
      listing: item.listing || '',
      snippet: item.snippet || '',
      time: item.time || '',
      unread: Boolean(item.unread),
    }));
  },
});
