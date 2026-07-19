import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
  normalizePixivPositiveInteger,
  pixivFetch,
  requirePixivId,
  requirePixivPayloadObject,
  requirePixivString,
} from './utils.js';

function dateOnly(value) {
  return typeof value === 'string' && value ? value.split('T')[0] : '';
}

function tagsToString(tags) {
  if (tags == null) return '';
  const payload = requirePixivPayloadObject(tags, 'Pixiv novel series tags');
  if (!Array.isArray(payload.tags)) {
    throw new CommandExecutionError('Pixiv novel series returned malformed tags payload');
  }
  const items = payload.tags;
  return items.map(t => t?.tag).filter(Boolean).join(', ');
}

function rowFromNovelBody(body, fallbackOrder) {
  const payload = requirePixivPayloadObject(body, 'Pixiv novel series item');
  const id = requirePixivId(payload.id, 'Pixiv novel series item');
  const title = requirePixivString(payload.title, 'Pixiv novel series item');
  const author = requirePixivString(payload.userName, 'Pixiv novel series item');
  const series = payload.seriesNavData && !Array.isArray(payload.seriesNavData) && typeof payload.seriesNavData === 'object' ? payload.seriesNavData : {};
  return {
    order: series.order ?? payload.seriesContentOrder ?? fallbackOrder,
    novel_id: id,
    title,
    author,
    words: payload.wordCount ?? '',
    characters: payload.characterCount ?? payload.textCount ?? '',
    bookmarks: payload.bookmarkCount ?? 0,
    tags: tagsToString(payload.tags),
    created: dateOnly(payload.createDate),
    url: `https://www.pixiv.net/novel/show.php?id=${id}`,
  };
}

function requireSeriesContents(body) {
  const payload = requirePixivPayloadObject(body, 'Pixiv novel series content');
  const page = requirePixivPayloadObject(payload.page, 'Pixiv novel series content');
  if (!Array.isArray(page.seriesContents)) {
    throw new CommandExecutionError('Pixiv novel series content returned malformed entries payload');
  }
  return page.seriesContents;
}

cli({
  site: 'pixiv',
  name: 'novel-series',
  access: 'read',
  description: 'List novels in a Pixiv novel series',
  domain: 'www.pixiv.net',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'id', positional: true, required: true, help: 'Novel series ID' },
    { name: 'limit', type: 'int', default: 30, help: 'Number of series entries' },
  ],
  columns: ['order', 'novel_id', 'title', 'author', 'words', 'characters', 'bookmarks', 'tags', 'created', 'url'],
  func: async (page, kwargs) => {
    const seriesId = String(kwargs.id ?? '').trim();
    const limit = normalizePixivPositiveInteger(kwargs.limit, 30, 'limit', { max: 100 });
    if (!/^\d+$/.test(seriesId)) {
      throw new ArgumentError(`Invalid novel series ID: ${seriesId}`);
    }

    requirePixivPayloadObject(await pixivFetch(page, `/ajax/novel/series/${seriesId}`, {
      notFoundMsg: `Novel series not found: ${seriesId}`,
    }), 'Pixiv novel series');
    const contentBody = await pixivFetch(page, `/ajax/novel/series_content/${seriesId}`, {
      params: { limit, last_order: 0, order_by: 'asc' },
      notFoundMsg: `Novel series content not found: ${seriesId}`,
    });
    const entries = requireSeriesContents(contentBody);
    const ids = entries.slice(0, limit).map(item => {
      const entry = requirePixivPayloadObject(item, 'Pixiv novel series content item');
      return requirePixivId(entry.id, 'Pixiv novel series content item');
    });

    const rows = [];
    for (let i = 0; i < ids.length; i += 1) {
      const body = await pixivFetch(page, `/ajax/novel/${ids[i]}`, {
        notFoundMsg: `Novel not found: ${ids[i]}`,
      });
      rows.push(rowFromNovelBody(body, i + 1));
    }
    return rows;
  },
});
