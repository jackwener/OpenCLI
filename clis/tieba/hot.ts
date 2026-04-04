import { EmptyResultError } from '../../errors.js';
import { cli, Strategy } from '../../registry.js';
import { normalizeTiebaLimit } from './utils.js';

cli({
  site: 'tieba',
  name: 'hot',
  description: 'Tieba hot topics',
  domain: 'tieba.baidu.com',
  strategy: Strategy.PUBLIC,
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of items to return' },
  ],
  columns: ['rank', 'title', 'discussions', 'description'],
  func: async (page, kwargs) => {
    const limit = normalizeTiebaLimit(kwargs.limit);
    // Use the default browser settle path so we do not scrape the previous page.
    await page.goto('https://tieba.baidu.com/hottopic/browse/topicList?res_type=1');

    const raw = await page.evaluate(`(() => {
      const items = document.querySelectorAll('li.topic-top-item');
      return Array.from(items).map((item) => {
        const titleEl = item.querySelector('a.topic-text');
        const numEl = item.querySelector('span.topic-num');
        const descEl = item.querySelector('p.topic-top-item-desc');
        const href = titleEl?.getAttribute('href') || '';

        return {
          title: titleEl?.textContent?.trim() || '',
          discussions: numEl?.textContent?.trim() || '',
          description: descEl?.textContent?.trim() || '',
          url: href.startsWith('http') ? href : 'https://tieba.baidu.com' + href,
        };
      }).filter((item) => item.title).slice(0, ${limit});
    })()`);

    const items = Array.isArray(raw) ? raw as Array<Record<string, string>> : [];
    if (!items.length) {
      throw new EmptyResultError('tieba hot', 'Tieba may have blocked the hot page, or the DOM structure may have changed');
    }

    return items.map((item, index) => ({
      rank: index + 1,
      title: item.title || '',
      discussions: item.discussions || '',
      description: item.description || '',
      url: item.url || '',
    }));
  },
});
