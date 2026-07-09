import { cli, Strategy } from '@jackwener/opencli/registry';
import { getCurrentPixivUser } from './utils.js';

cli({
  site: 'pixiv',
  name: 'me',
  access: 'read',
  description: 'Show the currently logged-in Pixiv account',
  domain: 'www.pixiv.net',
  strategy: Strategy.COOKIE,
  args: [],
  columns: ['user_id', 'name', 'premium', 'profile_image', 'url'],
  func: async (page) => {
    const user = await getCurrentPixivUser(page);
    return [{
      user_id: user.id,
      name: user.name,
      premium: user.premium,
      profile_image: user.profileImageUrl,
      url: `https://www.pixiv.net/users/${user.id}`,
    }];
  },
});
