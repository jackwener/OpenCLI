import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
  normalizePixivPositiveInteger,
  pixivFetch,
  requirePixivId,
  requirePixivPayloadObject,
  requirePixivString,
} from './utils.js';

function tagsToString(tags) {
  if (tags == null) return '';
  if (!Array.isArray(tags)) {
    throw new CommandExecutionError('Pixiv novel search returned malformed tags payload');
  }
  return tags.filter(tag => typeof tag === 'string' && tag.trim()).slice(0, 8).join(', ');
}

function dateOnly(value) {
  return typeof value === 'string' && value ? value.split('T')[0] : '';
}

function requireNovelSearchItems(body) {
  const payload = requirePixivPayloadObject(body, 'Pixiv novel search');
  const novel = requirePixivPayloadObject(payload.novel, 'Pixiv novel search');
  if (!Array.isArray(novel.data)) {
    throw new CommandExecutionError('Pixiv novel search returned malformed results payload');
  }
  return novel.data;
}

function novelSearchRow(item, rank) {
  const work = requirePixivPayloadObject(item, 'Pixiv novel search item');
  const id = requirePixivId(work.id, 'Pixiv novel search item');
  const title = requirePixivString(work.title, 'Pixiv novel search item');
  const author = requirePixivString(work.userName, 'Pixiv novel search item');
  const userId = requirePixivId(work.userId, 'Pixiv novel search item');
  return {
    rank,
    title,
    author,
    user_id: userId,
    novel_id: id,
    words: work.wordCount ?? '',
    characters: work.textCount ?? work.characterCount ?? '',
    bookmarks: work.bookmarkCount ?? 0,
    tags: tagsToString(work.tags),
    created: dateOnly(work.createDate),
    url: `https://www.pixiv.net/novel/show.php?id=${id}`,
  };
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
    const query = String(kwargs.query ?? '').trim();
    if (!query) {
      throw new ArgumentError('query is required');
    }
    const limit = normalizePixivPositiveInteger(kwargs.limit, 20, 'limit', { max: 100 });
    const pageNum = normalizePixivPositiveInteger(kwargs.page, 1, 'page');
    const order = kwargs.order ?? 'date_d';
    const mode = kwargs.mode ?? 'all';
    const encoded = encodeURIComponent(query);
    const body = await pixivFetch(page, `/ajax/search/novels/${encoded}`, {
      params: { word: query, order, mode, p: pageNum, s_mode: 's_tag', type: 'novel' },
    });
    const items = requireNovelSearchItems(body);
    return items
      .slice(0, limit)
      .map((item, i) => novelSearchRow(item, i + 1));
  },
});
