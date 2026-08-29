import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { pixivFetch } from './utils.js';
import { dateOnly, tagsToString } from './bookmark-utils.js';

function optionalCount(value, label) {
  if (value == null || value === '') return '';
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CommandExecutionError(`Pixiv novel returned malformed ${label}`);
  }
  return value;
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
  return { payload: body, identity: { novelId, title, userName, userId } };
}

export function novelRowFromBody(body, id) {
  const normalized = requireNovelBody(body, id);
  const b = normalized.payload;
  const identity = normalized.identity;
  if (b.seriesNavData != null && (Array.isArray(b.seriesNavData) || typeof b.seriesNavData !== 'object')) {
    throw new CommandExecutionError('Pixiv novel returned malformed series metadata');
  }
  const series = b.seriesNavData || {};
  const seriesId = b.seriesId ?? series.seriesId ?? '';
  const seriesTitle = b.seriesTitle ?? series.title ?? '';
  if (seriesId !== '' && !/^\d+$/.test(String(seriesId))) {
    throw new CommandExecutionError('Pixiv novel returned malformed series ID');
  }
  if (seriesTitle !== '' && typeof seriesTitle !== 'string') {
    throw new CommandExecutionError('Pixiv novel returned malformed series title');
  }
  const seriesOrder = series.order ?? b.seriesContentOrder ?? '';
  if (seriesOrder !== '' && (!Number.isSafeInteger(seriesOrder) || seriesOrder < 1)) {
    throw new CommandExecutionError('Pixiv novel returned malformed series order');
  }
  return {
    novel_id: identity.novelId,
    title: identity.title,
    author: identity.userName,
    user_id: identity.userId,
    series_id: seriesId === '' ? '' : String(seriesId),
    series_title: seriesTitle || '',
    series_order: seriesOrder,
    words: optionalCount(b.wordCount, 'word count'),
    characters: optionalCount(b.characterCount ?? b.textCount, 'character count'),
    bookmarks: optionalCount(b.bookmarkCount, 'bookmark count') || 0,
    likes: optionalCount(b.likeCount, 'like count') || 0,
    views: optionalCount(b.viewCount, 'view count') || 0,
    tags: tagsToString(b.tags),
    created: dateOnly(b.createDate),
    url: `https://www.pixiv.net/novel/show.php?id=${identity.novelId}`,
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
