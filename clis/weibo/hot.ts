/**
 * Weibo hot search — browser cookie API.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
  site: 'weibo',
  name: 'hot',
  description: '微博热搜',
  domain: 'weibo.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'limit', type: 'int', default: 30, help: 'Number of items (max 50)' },
  ],
  columns: ['rank', 'word', 'hot_value', 'category', 'label', 'url'],
  func: async (page, kwargs) => {
    const count = Math.min(kwargs.limit || 30, 50);
    await page.goto('https://weibo.com');
    const data = await page.evaluate(`
      (async () => {
        const resp = await fetch('/ajax/statuses/hot_band', {credentials: 'include'});
        if (!resp.ok) return {error: 'HTTP ' + resp.status};
        const data = await resp.json();
        if (!data.ok) return {error: 'API error'};
        const bandList = data.data?.band_list || [];
        return bandList.map((item, i) => ({
          rank: item.realpos || (i + 1),
          word: item.word,
          hot_value: item.num || 0,
          category: item.category || '',
          label: item.label_name || '',
          url: 'https://s.weibo.com/weibo?q=' + encodeURIComponent('#' + item.word + '#')
        }));
      })()
    `);
    if (!Array.isArray(data)) return [];
    return data.slice(0, count);
  },
});
