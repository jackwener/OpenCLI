import { cli, Strategy } from '../../registry.js';

// ── Twitter GraphQL constants ──────────────────────────────────────────

const BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

// ── Types ──────────────────────────────────────────────────────────────

interface TrendItem {
  rank: number;
  topic: string;
  tweets: string;
  category: string;
}

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

    // Extract CSRF token to verify login
    const ct0 = await page.evaluate(`(() => {
      return document.cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith('ct0='))?.split('=')[1] || null;
    })()`);
    if (!ct0) throw new Error('Not logged into x.com (no ct0 cookie)');

    // Try legacy guide.json API first (faster than DOM scraping)
    let trends: TrendItem[] = [];

    const apiData = await page.evaluate(`(async () => {
      const ct0 = document.cookie.split(';').map(c=>c.trim()).find(c=>c.startsWith('ct0='))?.split('=')[1] || '';
      const r = await fetch('/i/api/2/guide.json?include_page_configuration=true', {
        credentials: 'include',
        headers: {
          'x-twitter-active-user': 'yes',
          'x-csrf-token': ct0,
          'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA'
        }
      });
      return r.ok ? await r.json() : null;
    })()`);

    if (apiData) {
      const instructions = apiData?.timeline?.instructions || [];
      const entries = instructions.flatMap((inst: any) => inst?.addEntries?.entries || inst?.entries || []);
      const apiTrends = entries
        .filter((e: any) => e.content?.timelineModule)
        .flatMap((e: any) => e.content.timelineModule.items || [])
        .map((t: any) => t?.item?.content?.trend)
        .filter(Boolean);

      trends = apiTrends.map((t: any, i: number) => ({
        rank: i + 1,
        topic: t.name,
        tweets: t.tweetCount ? String(t.tweetCount) : 'N/A',
        category: t.trendMetadata?.domainContext || '',
      }));
    }

    // Fallback: scrape from the loaded DOM
    if (trends.length === 0) {
      await page.wait(2);
      const domTrends = await page.evaluate(`(() => {
        const items = [];
        const cells = document.querySelectorAll('[data-testid="trend"]');
        cells.forEach((cell) => {
          const text = cell.textContent || '';
          if (text.includes('Promoted')) return;
          const container = cell.querySelector(':scope > div');
          if (!container) return;
          const divs = container.children;
          // Structure: divs[0] = rank + category, divs[1] = topic name, divs[2] = extra
          const topicEl = divs.length >= 2 ? divs[1] : null;
          const topic = topicEl ? topicEl.textContent.trim() : '';
          const catEl = divs.length >= 1 ? divs[0] : null;
          const catText = catEl ? catEl.textContent.trim() : '';
          const category = catText.replace(/^\\d+\\s*/, '').replace(/^\\xB7\\s*/, '').trim();
          const extraEl = divs.length >= 3 ? divs[2] : null;
          const extra = extraEl ? extraEl.textContent.trim() : '';
          if (topic) {
            items.push({ rank: items.length + 1, topic, tweets: extra || 'N/A', category });
          }
        });
        return items;
      })()`);

      if (Array.isArray(domTrends) && domTrends.length > 0) {
        trends = domTrends;
      }
    }

    if (trends.length === 0) {
      throw new Error('No trending data found. API may have changed or login may be required.');
    }

    return trends.slice(0, limit);
  },
});
