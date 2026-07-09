import { cli, Strategy } from '@jackwener/opencli/registry';
import { pixivFetch } from './utils.js';

function tagsToString(tags) {
  return Array.isArray(tags) ? tags.filter(Boolean).slice(0, 8).join(', ') : '';
}

function dateOnly(value) {
  return typeof value === 'string' && value ? value.split('T')[0] : '';
}

cli({
  site: 'pixiv',
  name: 'novel-search',
  access: 'read',
  description: 'Search Pixiv novels by keyword or tag',
  domain: 'www.pixiv.net',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'query', positional: true, required: true, help: 'Search keyword or tag' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
    { name: 'order', type: 'str', default: 'date_d', help: 'Sort order', choices: ['date_d', 'date', 'popular_d'] },
    { name: 'mode', type: 'str', default: 'all', help: 'Search mode', choices: ['all', 'safe', 'r18'] },
    { name: 'page', type: 'int', default: 1, help: 'Page number' },
  ],
  columns: ['rank', 'title', 'author', 'user_id', 'novel_id', 'words', 'characters', 'bookmarks', 'tags', 'created', 'url'],
  func: async (page, kwargs) => {
    const { query, limit = 20, order = 'date_d', mode = 'all', page: pageNum = 1 } = kwargs;
    const encoded = encodeURIComponent(query);
    const body = await pixivFetch(page, `/ajax/search/novels/${encoded}`, {
      params: { word: query, order, mode, p: pageNum, s_mode: 's_tag', type: 'novel' },
    });
    const items = body?.novel?.data || [];
    return items
      .filter(item => item.id)
      .slice(0, Number(limit))
      .map((item, i) => ({
        rank: i + 1,
        title: item.title || '',
        author: item.userName || '',
        user_id: item.userId || '',
        novel_id: String(item.id),
        words: item.wordCount ?? '',
        characters: item.textCount ?? item.characterCount ?? '',
        bookmarks: item.bookmarkCount ?? 0,
        tags: tagsToString(item.tags),
        created: dateOnly(item.createDate),
        url: `https://www.pixiv.net/novel/show.php?id=${item.id}`,
      }));
  },
});
