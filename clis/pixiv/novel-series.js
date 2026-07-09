import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { pixivFetch } from './utils.js';

function dateOnly(value) {
  return typeof value === 'string' && value ? value.split('T')[0] : '';
}

function tagsToString(tags) {
  const items = Array.isArray(tags?.tags) ? tags.tags : [];
  return items.map(t => t?.tag).filter(Boolean).join(', ');
}

function rowFromNovelBody(body, fallbackOrder) {
  const id = String(body?.id ?? '').trim();
  if (!/^\d+$/.test(id)) return null;
  const series = body.seriesNavData && typeof body.seriesNavData === 'object' ? body.seriesNavData : {};
  return {
    order: series.order ?? body.seriesContentOrder ?? fallbackOrder,
    novel_id: id,
    title: body.title || '',
    author: body.userName || '',
    words: body.wordCount ?? '',
    characters: body.characterCount ?? body.textCount ?? '',
    bookmarks: body.bookmarkCount ?? 0,
    tags: tagsToString(body.tags),
    created: dateOnly(body.createDate),
    url: `https://www.pixiv.net/novel/show.php?id=${id}`,
  };
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
    const seriesId = String(kwargs.id ?? '');
    const limit = Number(kwargs.limit) || 30;
    if (!/^\d+$/.test(seriesId)) {
      throw new CommandExecutionError(`Invalid novel series ID: ${seriesId}`);
    }

    await pixivFetch(page, `/ajax/novel/series/${seriesId}`, {
      notFoundMsg: `Novel series not found: ${seriesId}`,
    });
    const contentBody = await pixivFetch(page, `/ajax/novel/series_content/${seriesId}`, {
      params: { limit, last_order: 0, order_by: 'asc' },
      notFoundMsg: `Novel series content not found: ${seriesId}`,
    });
    const entries = contentBody?.page?.seriesContents || [];
    const ids = entries.map(item => String(item?.id || '')).filter(id => /^\d+$/.test(id)).slice(0, limit);

    const rows = [];
    for (let i = 0; i < ids.length; i += 1) {
      const body = await pixivFetch(page, `/ajax/novel/${ids[i]}`, {
        notFoundMsg: `Novel not found: ${ids[i]}`,
      });
      const row = rowFromNovelBody(body, i + 1);
      if (row) rows.push(row);
    }
    return rows;
  },
});
