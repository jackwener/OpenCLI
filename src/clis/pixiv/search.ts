/**
 * Pixiv search — search illustrations by keyword/tag.
 *
 * Uses the internal Ajax search API with browser cookies for authentication.
 */

import { cli, Strategy } from '../../registry.js';
import { AuthRequiredError, CommandExecutionError } from '../../errors.js';

cli({
  site: 'pixiv',
  name: 'search',
  description: 'Search Pixiv illustrations by keyword',
  domain: 'www.pixiv.net',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'query', positional: true, required: true, help: 'Search keyword or tag' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
    { name: 'order', type: 'str', default: 'date_d', help: 'Sort order', choices: ['date_d', 'date', 'popular_d', 'popular_male_d', 'popular_female_d'] },
    { name: 'mode', type: 'str', default: 'all', help: 'Search mode', choices: ['all', 'safe', 'r18'] },
    { name: 'page', type: 'int', default: 1, help: 'Page number' },
  ],
  columns: ['rank', 'title', 'author', 'illust_id', 'pages', 'bookmarks', 'tags'],

  func: async (page, kwargs) => {
    const { query, limit = 20, order = 'date_d', mode = 'all', page: pageNum = 1 } = kwargs;

    await page.goto('https://www.pixiv.net');

    const data: any = await page.evaluate(`
      (async () => {
        const keyword = ${JSON.stringify(query)};
        const encoded = encodeURIComponent(keyword);
        const order = ${JSON.stringify(order)};
        const mode = ${JSON.stringify(mode)};
        const pageNum = ${JSON.stringify(pageNum)};
        const res = await fetch(
          'https://www.pixiv.net/ajax/search/illustrations/' +
          encoded +
          '?word=' + encoded +
          '&order=' + order +
          '&mode=' + mode +
          '&p=' + pageNum +
          '&s_mode=s_tag_full' +
          '&type=illust_and_ugoira',
          { credentials: 'include' }
        );
        if (!res.ok) return { error: res.status };
        return await res.json();
      })()
    `);

    if (data?.error) {
      if (data.error === 401 || data.error === 403) {
        throw new AuthRequiredError('www.pixiv.net', 'Authentication required — please log in to Pixiv in Chrome');
      }
      throw new CommandExecutionError(`Pixiv request failed (HTTP ${data.error})`);
    }

    const items: any[] = data?.body?.illust?.data || [];

    return items
      .filter((item: any) => item.id)
      .slice(0, Number(limit))
      .map((item: any, i: number) => ({
        rank: i + 1,
        title: item.title || '',
        author: item.userName || '',
        user_id: item.userId || '',
        illust_id: item.id,
        pages: item.pageCount || 1,
        bookmarks: item.bookmarkCount || 0,
        tags: (item.tags || []).slice(0, 5).join(', '),
        url: 'https://www.pixiv.net/artworks/' + item.id,
      }));
  },
});
