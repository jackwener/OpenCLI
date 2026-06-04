import { cli, Strategy } from '@jackwener/opencli/registry';
import { buildLiveCardExtractor, requireDouyuLogin } from './public-utils.js';

function normalizeLimit(raw) {
  const limit = Number(raw ?? 20);
  if (!Number.isFinite(limit) || limit < 1) return 20;
  return Math.min(50, Math.floor(limit));
}

export const command = cli({
  site: 'douyu',
  name: 'history',
  description: '获取斗鱼观看历史',
  access: 'read',
  example: 'opencli douyu history --limit 10 -f yaml',
  domain: 'www.douyu.com',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  siteSession: 'persistent',
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of results to return (1-50)' },
  ],
  columns: ['rank', 'title', 'streamer', 'watching', 'category', 'url'],
  func: async (page, kwargs) => {
    const limit = normalizeLimit(kwargs.limit);
    await page.goto('https://www.douyu.com/directory/watchHistory', { waitUntil: 'load', settleMs: 3000 });
    await page.wait({ time: 5 });
    const result = await page.evaluate(buildLiveCardExtractor(limit));
    const rows = Array.isArray(result?.rows) ? result.rows : [];
    if (result?.isUnLogin || rows.length === 0) {
      requireDouyuLogin('Douyu login is required to read watch history');
    }
    return rows.map((item, index) => ({ rank: index + 1, ...item }));
  },
});
