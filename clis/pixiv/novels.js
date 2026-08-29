import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import {
  BATCH_SIZE,
  normalizePixivPositiveInteger,
  pixivFetch,
  requirePixivId,
  requirePixivPayloadObject,
  requirePixivString,
} from './utils.js';
import { dateOnly, tagsToString } from './bookmark-utils.js';

function optionalCount(value, label, fallback = '') {
  if (value == null || value === '') return fallback;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CommandExecutionError(`Pixiv user novel item returned malformed ${label}`);
  }
  return value;
}

function userNovelRow(work, rank, expectedId) {
  const item = requirePixivPayloadObject(work, 'Pixiv user novel item');
  const id = requirePixivId(item.id, 'Pixiv user novel item');
  if (id !== expectedId) {
    throw new CommandExecutionError(`Pixiv user novels returned mismatched novel detail payload for ${expectedId}`);
  }
  const title = requirePixivString(item.title, 'Pixiv user novel item');
  return {
    rank,
    title,
    novel_id: id,
    words: optionalCount(item.wordCount, 'word count'),
    characters: optionalCount(item.textCount ?? item.characterCount, 'character count'),
    bookmarks: optionalCount(item.bookmarkCount, 'bookmark count', 0),
    tags: tagsToString(item.tags),
    created: dateOnly(item.createDate),
    url: `https://www.pixiv.net/novel/show.php?id=${id}`,
  };
}

function requireProfileNovelIds(body) {
  const payload = requirePixivPayloadObject(body, 'Pixiv user profile');
  if (!payload.novels || Array.isArray(payload.novels) || typeof payload.novels !== 'object') {
    throw new CommandExecutionError('Pixiv user profile returned malformed novels payload');
  }
  const ids = Object.keys(payload.novels);
  const invalid = ids.find(id => !/^\d+$/.test(id));
  if (invalid) {
    throw new CommandExecutionError(`Pixiv user profile returned malformed novel ID: ${invalid}`);
  }
  return ids;
}

function requireDetailWorks(body) {
  const payload = requirePixivPayloadObject(body, 'Pixiv user novel details');
  if (!payload.works || Array.isArray(payload.works) || typeof payload.works !== 'object') {
    throw new CommandExecutionError('Pixiv user novel details returned malformed works payload');
  }
  return payload.works;
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
    const userId = String(kwargs['user-id'] ?? '').trim();
    const limit = normalizePixivPositiveInteger(kwargs.limit, 20, 'limit', { max: 100 });
    if (!/^\d+$/.test(userId)) {
      throw new ArgumentError(`Invalid user ID: ${userId}`);
    }

    const profileBody = await pixivFetch(page, `/ajax/user/${userId}/profile/all`, {
      notFoundMsg: `User not found: ${userId}`,
    });
    const allIds = requireProfileNovelIds(profileBody)
      .sort((a, b) => (BigInt(a) < BigInt(b) ? 1 : (BigInt(a) > BigInt(b) ? -1 : 0)))
      .slice(0, limit);
    if (allIds.length === 0) return [];

    const allWorks = {};
    for (let offset = 0; offset < allIds.length; offset += BATCH_SIZE) {
      const batch = allIds.slice(offset, offset + BATCH_SIZE);
      const idsParam = batch.map(id => `ids[]=${id}`).join('&');
      const detailBody = await pixivFetch(page, `/ajax/user/${userId}/profile/novels?${idsParam}&is_first_page=${offset === 0 ? 1 : 0}`);
      Object.assign(allWorks, requireDetailWorks(detailBody));
    }

    return allIds.map((id, i) => {
      const work = allWorks[id];
      if (!work) {
        throw new CommandExecutionError(`Pixiv user novels missing detail payload for ${id}`);
      }
      return userNovelRow(work, i + 1, id);
    });
  },
});
