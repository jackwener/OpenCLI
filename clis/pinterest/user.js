// Pinterest user — a user's public profile stats (UserResource, single row).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { PINTEREST_BASE, parseUsername, pinterestResourceFetch } from './utils.js';

cli({
  site: 'pinterest',
  name: 'user',
  access: 'read',
  description: 'Get a Pinterest user\'s public profile stats',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'username', type: 'string', positional: true, required: true, help: 'Username or profile URL, e.g. janedoe' },
  ],
  columns: ['username', 'fullName', 'followerCount', 'followingCount', 'interestFollowingCount', 'pinCount', 'boardCount', 'about', 'website', 'url'],
  func: async (page, kwargs) => {
    const username = parseUsername(kwargs.username);
    const sourceUrl = `/${username}/`;

    await page.goto(`${PINTEREST_BASE}${sourceUrl}`);

    const { data: user } = await pinterestResourceFetch(
      page,
      'UserResource',
      { username, field_set_key: 'profile' },
      sourceUrl,
    );
    if (!user || !user.username) {
      throw new EmptyResultError('pinterest user', `user "${username}" not found`);
    }

    const num = (value) => (typeof value === 'number' ? value : 0);
    return [{
      username: user.username,
      fullName: (user.full_name || '').trim(),
      followerCount: num(user.follower_count),
      // following_count is Pinterest's API total (followed people + topics/interests).
      followingCount: num(user.following_count),
      interestFollowingCount: num(user.interest_following_count),
      pinCount: num(user.pin_count),
      boardCount: num(user.board_count),
      about: (user.about || '').trim(),
      website: user.domain_url || '',
      url: `${PINTEREST_BASE}/${user.username}/`,
    }];
  },
});
