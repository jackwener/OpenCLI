import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildLiveCardExtractor, requireRows } from './public-utils.js';

function normalizeLimit(raw) {
  const limit = Number(raw ?? 20);
  if (!Number.isFinite(limit) || limit < 1) return 20;
  return Math.min(50, Math.floor(limit));
}

export const command = cli({
  site: 'douyu',
  name: 'home',
  description: '获取斗鱼首页推荐直播',
  access: 'read',
  example: 'opencli douyu home --limit 10 -f yaml',
  domain: 'www.douyu.com',
  strategy: Strategy.PUBLIC,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of results to return (1-50)' },
  ],
  columns: ['rank', 'title', 'streamer', 'watching', 'category', 'url'],
  func: async (page, kwargs) => {
    const limit = normalizeLimit(kwargs.limit);
    await page.goto('https://www.douyu.com/', { waitUntil: 'load', settleMs: 3000 });
    await page.wait({ time: 3 });
    const result = await page.evaluate(buildLiveCardExtractor(limit));
    const rows = Array.isArray(result?.rows) ? result.rows : [];
    return requireRows(rows, 'douyu home', 'No Douyu home live cards found')
      .map((item, index) => ({ rank: index + 1, ...item }));
  },
});
