import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { pixivFetch } from './utils.js';

function tagsToString(tags) {
  const items = Array.isArray(tags?.tags) ? tags.tags : [];
  return items.map(t => t?.tag).filter(Boolean).join(', ');
}

function dateOnly(value) {
  return typeof value === 'string' && value ? value.split('T')[0] : '';
}

function requireNovelBody(body, id) {
  if (!body || Array.isArray(body) || typeof body !== 'object') {
    throw new CommandExecutionError(`Pixiv novel ${id} returned malformed detail payload`);
  }
  const novelId = String(body.id ?? '').trim();
  const title = String(body.title ?? '').trim();
  const userName = String(body.userName ?? '').trim();
  const userId = String(body.userId ?? '').trim();
  if (!/^\d+$/.test(novelId) || novelId !== id || !title || !userName || !/^\d+$/.test(userId)) {
    throw new CommandExecutionError(`Pixiv novel ${id} returned malformed detail payload`);
  }
  body.id = novelId;
  body.title = title;
  body.userName = userName;
  body.userId = userId;
  return body;
}

export function novelRowFromBody(body, id) {
  const b = requireNovelBody(body, id);
  const series = b.seriesNavData && typeof b.seriesNavData === 'object' ? b.seriesNavData : {};
  const seriesId = b.seriesId ?? series.seriesId ?? '';
  const seriesTitle = b.seriesTitle ?? series.title ?? '';
  return {
    novel_id: b.id,
    title: b.title,
    author: b.userName,
    user_id: b.userId,
    series_id: seriesId === '' ? '' : String(seriesId),
    series_title: seriesTitle || '',
    series_order: series.order ?? b.seriesContentOrder ?? '',
    words: b.wordCount ?? '',
    characters: b.characterCount ?? b.textCount ?? '',
    bookmarks: b.bookmarkCount ?? 0,
    likes: b.likeCount ?? 0,
    views: b.viewCount ?? 0,
    tags: tagsToString(b.tags),
    created: dateOnly(b.createDate),
    url: `https://www.pixiv.net/novel/show.php?id=${b.id}`,
  };
}

cli({
  site: 'pixiv',
  name: 'novel',
  access: 'read',
  description: 'View Pixiv novel metadata (title, author, series, tags, stats)',
  domain: 'www.pixiv.net',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'id', required: true, positional: true, help: 'Novel ID' },
  ],
  columns: ['novel_id', 'title', 'author', 'user_id', 'series_id', 'series_title', 'series_order', 'words', 'characters', 'bookmarks', 'likes', 'views', 'tags', 'created', 'url'],
  func: async (page, kwargs) => {
    const id = String(kwargs.id ?? '');
    if (!/^\d+$/.test(id)) {
      throw new ArgumentError(`Invalid novel ID: ${id}`, 'Example: opencli pixiv novel 10588915');
    }
    const body = await pixivFetch(page, `/ajax/novel/${id}`, {
      notFoundMsg: `Novel not found: ${id}`,
    });
    return [novelRowFromBody(body, id)];
  },
});
