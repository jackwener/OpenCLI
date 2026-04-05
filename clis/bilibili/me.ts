import { cli, Strategy } from '@jackwener/opencli/registry';
import { apiGet, getSelfUid } from './utils.js';

cli({
  site: 'bilibili', name: 'me', description: 'My Bilibili profile info', domain: 'www.bilibili.com', strategy: Strategy.COOKIE,
  args: [],
  columns: ['name', 'uid', 'level', 'coins', 'followers', 'following'],
  func: async (page) => {
    const uid = await getSelfUid(page);
    const payload = await apiGet(page, '/x/space/wbi/acc/info', { params: { mid: uid }, signed: true });
    const data = payload?.data ?? {};
    return { name: data.name ?? '', uid: data.mid ?? uid, level: data.level ?? 0, coins: data.coins ?? 0, followers: data.follower ?? 0, following: data.following ?? 0 };
  },
});
