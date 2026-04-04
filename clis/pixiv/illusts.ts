/**
 * Pixiv illusts — list illustrations by an artist.
 *
 * Two-step process:
 * 1. Fetch all illust IDs from the user's profile
 * 2. Batch-fetch details for the most recent ones (max 48 IDs per request)
 */

import { cli, Strategy } from '../../src/registry.js';
import { CommandExecutionError } from '../../src/errors.js';
import { pixivFetch, BATCH_SIZE } from './utils.js';

cli({
  site: 'pixiv',
  name: 'illusts',
  description: "List a Pixiv artist's illustrations",
  domain: 'www.pixiv.net',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'user-id', positional: true, required: true, help: 'Pixiv user ID' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of results' },
  ],
  columns: ['rank', 'title', 'illust_id', 'pages', 'bookmarks', 'tags', 'created'],

  func: async (page, kwargs) => {
    const userId = String(kwargs['user-id'] ?? '');
    const limit = Number(kwargs.limit) || 20;

    if (!/^\d+$/.test(userId)) {
      throw new CommandExecutionError(`Invalid user ID: ${userId}`);
    }

    // Step 1: get all illust IDs
    const profileBody = await pixivFetch(page, `/ajax/user/${userId}/profile/all`, {
      notFoundMsg: `User not found: ${userId}`,
    });

    const allIds = Object.keys(profileBody?.illusts || {})
      .sort((a, b) => Number(b) - Number(a))
      .slice(0, limit);

    if (allIds.length === 0) return [];

    // Step 2: batch fetch details (Pixiv supports up to ~48 IDs per request)
    const allWorks: Record<string, any> = {};

    for (let offset = 0; offset < allIds.length; offset += BATCH_SIZE) {
      const batch = allIds.slice(offset, offset + BATCH_SIZE);
      const idsParam = batch.map(id => `ids[]=${id}`).join('&');

      // pixivFetch navigates on each call; for subsequent batches we re-navigate,
      // which is fine — the cookie is already attached.
      const detailBody = await pixivFetch(
        page,
        `/ajax/user/${userId}/profile/illusts?${idsParam}&work_category=illustManga&is_first_page=${offset === 0 ? 1 : 0}`,
      );

      Object.assign(allWorks, detailBody?.works || {});
    }

    return allIds
      .map((id, i) => {
        const w = allWorks[id];
        if (!w) return null;
        return {
          rank: i + 1,
          title: w.title || '',
          illust_id: w.id,
          pages: w.pageCount || 1,
          bookmarks: w.bookmarkCount || 0,
          tags: (w.tags || []).slice(0, 5).join(', '),
          created: (w.createDate || '').split('T')[0],
          url: 'https://www.pixiv.net/artworks/' + w.id,
        };
      })
      .filter(Boolean);
  },
});
