/**
 * Weibo user — get user profile by uid or screen_name.
 */
import { cli, Strategy } from '../../registry.js';
import { CommandExecutionError } from '../../errors.js';

cli({
  site: 'weibo',
  name: 'user',
  description: 'Get Weibo user profile',
  domain: 'weibo.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'id', required: true, positional: true, help: 'User ID (numeric uid) or screen name' },
  ],
  columns: ['screen_name', 'uid', 'followers', 'following', 'statuses', 'verified', 'description', 'location', 'url'],
  func: async (page, kwargs) => {
    await page.goto('https://weibo.com');
    await page.wait(2);

    const id = String(kwargs.id);
    const data = await page.evaluate(`
      (async () => {
        const id = ${JSON.stringify(id)};
        const isUid = /^\\d+$/.test(id);
        const query = isUid ? 'uid=' + id : 'screen_name=' + encodeURIComponent(id);

        const resp = await fetch('/ajax/profile/info?' + query, {credentials: 'include'});
        if (!resp.ok) return {error: 'HTTP ' + resp.status};
        const data = await resp.json();
        if (!data.ok || !data.data?.user) return {error: 'User not found'};

        const u = data.data.user;

        // Fetch detail info
        const detailResp = await fetch('/ajax/profile/detail?uid=' + u.id, {credentials: 'include'});
        const detail = detailResp.ok ? await detailResp.json() : null;
        const d = detail?.data || {};

        return {
          screen_name: u.screen_name,
          uid: u.id,
          followers: u.followers_count,
          following: u.friends_count,
          statuses: u.statuses_count,
          verified: u.verified || false,
          verified_reason: u.verified_reason || '',
          description: u.description || d.description || '',
          location: u.location || '',
          gender: u.gender === 'm' ? 'male' : u.gender === 'f' ? 'female' : '',
          avatar: u.avatar_hd || u.avatar_large || '',
          url: 'https://weibo.com' + (u.profile_url || '/u/' + u.id),
          birthday: d.birthday || '',
          created_at: d.created_at || '',
          ip_location: d.ip_location || '',
        };
      })()
    `);

    if (!data || typeof data !== 'object') throw new CommandExecutionError('Failed to fetch user profile');
    if ((data as Record<string, unknown>).error) throw new CommandExecutionError(String((data as Record<string, unknown>).error));
    return data as Record<string, unknown>;
  },
});
