/**
 * Weibo me — current logged-in user profile.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { getSelfUid } from './utils.js';
cli({
    site: 'weibo',
    name: 'me',
    description: 'My Weibo profile info',
    domain: 'weibo.com',
    strategy: Strategy.COOKIE,
    args: [],
    columns: ['screen_name', 'uid', 'followers', 'following', 'statuses', 'verified', 'location'],
    func: async (page) => {
        await page.goto('https://weibo.com');
        await page.wait(2);
        const uid = await getSelfUid(page);
        const data = await page.evaluate(`
      (async () => {
        const uid = ${JSON.stringify(uid)};

        // Try Vue store first
        const app = document.querySelector('#app')?.__vue_app__;
        const store = app?.config?.globalProperties?.$store;
        const cfg = store?.state?.config?.config;
        const u = cfg?.user;

        // Fetch detail info
        const detailResp = await fetch('/ajax/profile/detail?uid=' + uid, {credentials: 'include'});
        const detail = detailResp.ok ? await detailResp.json() : null;
        const d = detail?.data || {};

        if (u && u.id) {
          return {
            screen_name: u.screen_name,
            uid: u.id,
            followers: u.followers_count,
            following: u.friends_count,
            statuses: u.statuses_count,
            verified: u.verified || false,
            location: u.location || '',
            description: u.description || d.description || '',
            avatar: u.avatar_hd || u.avatar_large || '',
            profile_url: 'https://weibo.com' + (u.profile_url || '/u/' + u.id),
          };
        }

        // Fallback: fetch profile API
        const resp = await fetch('/ajax/profile/info?uid=' + uid, {credentials: 'include'});
        if (!resp.ok) return {error: 'HTTP ' + resp.status};
        const info = await resp.json();
        if (!info.ok) return {error: 'API error'};
        const p = info.data?.user;
        if (!p) return {error: 'User data not found'};
        return {
          screen_name: p.screen_name,
          uid: p.id,
          followers: p.followers_count,
          following: p.friends_count,
          statuses: p.statuses_count,
          verified: p.verified || false,
          location: p.location || '',
          description: p.description || d.description || '',
          avatar: p.avatar_hd || p.avatar_large || '',
          profile_url: 'https://weibo.com' + (p.profile_url || '/u/' + p.id),
        };
      })()
    `);
        if (!data || typeof data !== 'object')
            throw new CommandExecutionError('Failed to fetch profile');
        if (data.error)
            throw new CommandExecutionError(String(data.error));
        return data;
    },
});
