import { cli, Strategy } from '@jackwener/opencli/registry';
import { fetchCurrentBookmarks } from './bookmark-utils.js';

cli({
  site: 'pixiv',
  name: 'bookmarks',
  access: 'read',
  description: 'List the current Pixiv account bookmarks for illustrations or novels',
  domain: 'www.pixiv.net',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'type', default: 'illust', help: 'Bookmark type: illust or novel' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of bookmarks to list' },
    { name: 'offset', type: 'int', default: 0, help: 'Pagination offset' },
    { name: 'visibility', default: 'show', help: 'Bookmark visibility: show(public) or hide(private)' },
  ],
  columns: ['rank', 'type', 'title', 'author', 'user_id', 'illust_id', 'novel_id', 'pages', 'words', 'bookmarks', 'tags', 'created', 'url'],
  func: async (page, kwargs) => fetchCurrentBookmarks(page, kwargs),
});
