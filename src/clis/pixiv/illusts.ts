/**
 * Pixiv illusts — list illustrations by an artist.
 *
 * Two-step process:
 * 1. Fetch all illust IDs from the user's profile
 * 2. Batch-fetch details for the most recent ones
 */

import { cli, Strategy } from '../../registry.js';
import { AuthRequiredError, CommandExecutionError } from '../../errors.js';

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
    const userId = kwargs['user-id'];
    const limit = Number(kwargs.limit) || 20;

    await page.goto('https://www.pixiv.net');

    // Step 1: get all illust IDs
    const profileData: any = await page.evaluate(`
      (async () => {
        const userId = ${JSON.stringify(userId)};
        const res = await fetch(
          'https://www.pixiv.net/ajax/user/' + userId + '/profile/all',
          { credentials: 'include' }
        );
        if (!res.ok) return { error: res.status };
        return await res.json();
      })()
    `);

    if (profileData?.error) {
      if (profileData.error === 401 || profileData.error === 403) {
        throw new AuthRequiredError('www.pixiv.net', 'Authentication required — please log in to Pixiv in Chrome');
      }
      throw new CommandExecutionError(`Pixiv request failed (HTTP ${profileData.error})`);
    }

    const allIds = Object.keys(profileData?.body?.illusts || {})
      .sort((a, b) => Number(b) - Number(a))
      .slice(0, limit);

    if (allIds.length === 0) return [];

    // Step 2: batch fetch details (Pixiv supports up to ~48 IDs per request)
    const idsParam = allIds.map(id => 'ids[]=' + id).join('&');
    const detailData: any = await page.evaluate(`
      (async () => {
        const userId = ${JSON.stringify(userId)};
        const idsParam = ${JSON.stringify(idsParam)};
        const res = await fetch(
          'https://www.pixiv.net/ajax/user/' + userId + '/profile/illusts?' +
          idsParam +
          '&work_category=illustManga&is_first_page=1',
          { credentials: 'include' }
        );
        if (!res.ok) return { error: res.status };
        return await res.json();
      })()
    `);

    if (detailData?.error) {
      throw new CommandExecutionError(`Pixiv batch detail request failed (HTTP ${detailData.error})`);
    }

    const works = detailData?.body?.works || {};

    return allIds
      .map((id, i) => {
        const w = works[id];
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
