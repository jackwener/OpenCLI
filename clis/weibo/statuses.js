/**
 * Weibo statuses — fetch a user's public timeline / blog posts.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';

cli({
    site: 'weibo',
    name: 'statuses',
    description: "Fetch a user's Weibo statuses/timeline",
    domain: 'weibo.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'id', required: true, positional: true, help: 'User ID (numeric uid) or screen name' },
        { name: 'limit', type: 'int', default: 15, help: 'Number of posts (max 50)' },
        { name: 'page', type: 'int', default: 1, help: 'Page number' },
    ],
    columns: ['id', 'mblogid', 'text', 'isLongText', 'created_at', 'reposts', 'comments', 'likes', 'pic_num', 'url'],
    func: async (page, kwargs) => {
        const count = Math.min(kwargs.limit || 15, 50);
        const pageNum = kwargs.page || 1;
        const id = String(kwargs.id);

        await page.goto('https://weibo.com');
        await page.wait(2);

        // Resolve uid if screen name was provided
        const isUid = /^\d+$/.test(id);
        let uid = id;
        if (!isUid) {
            const profileResp = await page.evaluate(`
        (async () => {
          const resp = await fetch('/ajax/profile/info?screen_name=' + encodeURIComponent(${JSON.stringify(id)}), { credentials: 'include' });
          if (!resp.ok) return { error: 'HTTP ' + resp.status };
          const data = await resp.json();
          if (!data.ok || !data.data?.user) return { error: 'User not found' };
          return { uid: data.data.user.id };
        })()
      `);
            if (profileResp.error) {
                throw new CommandExecutionError(String(profileResp.error));
            }
            uid = String(profileResp.uid);
        }

        const data = await page.evaluate(`
      (async () => {
        const uid = ${JSON.stringify(uid)};
        const count = ${count};
        const page = ${pageNum};

        const strip = (html) => (html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();

        const resp = await fetch('/ajax/statuses/mymblog?uid=' + uid + '&page=' + page + '&feature=0', { credentials: 'include' });
        if (!resp.ok) return { error: 'HTTP ' + resp.status };
        const data = await resp.json();
        if (!data.ok) return { error: 'API error: ' + (data.msg || 'unknown') };

        return (data.data?.list || []).slice(0, count).map(s => {
          const u = s.user || {};
          const item = {
            id: s.idstr || '',
            mblogid: s.mblogid || '',
            text: (s.text_raw || strip(s.text || '')).substring(0, 500),
            isLongText: s.isLongText || false,
            created_at: s.created_at || '',
            reposts: s.reposts_count || 0,
            comments: s.comments_count || 0,
            likes: s.attitudes_count || 0,
            pic_num: s.pic_num || 0,
            url: 'https://weibo.com/' + (u.id || '') + '/' + (s.mblogid || ''),
          };
          if (s.retweeted_status) {
            const rt = s.retweeted_status;
            item.retweeted = (rt.user?.screen_name || '[deleted]') + ': ' + (rt.text_raw || strip(rt.text || '')).substring(0, 200);
          }
          if (s.page_info) {
            item.page_title = s.page_info.title || '';
            item.page_type = s.page_info.type || '';
            item.page_url = s.page_info.page_url || '';
          }
          return item;
        });
      })()
    `);

        if (!Array.isArray(data)) {
            if (data && data.error) {
                throw new CommandExecutionError(String(data.error));
            }
            return [];
        }
        return data;
    },
});
