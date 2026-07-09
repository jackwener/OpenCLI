import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { pixivFetch, BATCH_SIZE } from './utils.js';

function dateOnly(value) {
  return typeof value === 'string' && value ? value.split('T')[0] : '';
}

function workTagsToString(tags) {
  return Array.isArray(tags) ? tags.filter(Boolean).slice(0, 8).join(', ') : '';
}

function userNovelRow(work, rank) {
  return {
    rank,
    title: work.title || '',
    novel_id: String(work.id || ''),
    words: work.wordCount ?? '',
    characters: work.textCount ?? work.characterCount ?? '',
    bookmarks: work.bookmarkCount ?? 0,
    tags: workTagsToString(work.tags),
    created: dateOnly(work.createDate),
    url: `https://www.pixiv.net/novel/show.php?id=${work.id}`,
  };
}

cli({
  site: 'pixiv',
  name: 'novels',
  access: 'read',
  description: "List a Pixiv user's novels",
  domain: 'www.pixiv.net',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'user-id', positional: true, required: true, help: 'Pixiv user ID' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
  ],
  columns: ['rank', 'title', 'novel_id', 'words', 'characters', 'bookmarks', 'tags', 'created', 'url'],
  func: async (page, kwargs) => {
    const userId = String(kwargs['user-id'] ?? '');
    const limit = Number(kwargs.limit) || 20;
    if (!/^\d+$/.test(userId)) {
      throw new CommandExecutionError(`Invalid user ID: ${userId}`);
    }

    const profileBody = await pixivFetch(page, `/ajax/user/${userId}/profile/all`, {
      notFoundMsg: `User not found: ${userId}`,
    });
    const allIds = Object.keys(profileBody?.novels || {})
      .sort((a, b) => Number(b) - Number(a))
      .slice(0, limit);
    if (allIds.length === 0) return [];

    const allWorks = {};
    for (let offset = 0; offset < allIds.length; offset += BATCH_SIZE) {
      const batch = allIds.slice(offset, offset + BATCH_SIZE);
      const idsParam = batch.map(id => `ids[]=${id}`).join('&');
      const detailBody = await pixivFetch(page, `/ajax/user/${userId}/profile/novels?${idsParam}&is_first_page=${offset === 0 ? 1 : 0}`);
      Object.assign(allWorks, detailBody?.works || {});
    }

    return allIds
      .map((id, i) => {
        const work = allWorks[id];
        return work ? userNovelRow(work, i + 1) : null;
      })
      .filter(Boolean);
  },
});
