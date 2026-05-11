/**
 * Weibo comments — get comments on a post.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
cli({
    site: 'weibo',
    name: 'comments',
    access: 'read',
    description: 'Get comments on a Weibo post',
    domain: 'weibo.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'id', required: true, positional: true, help: 'Post ID (numeric idstr)' },
        { name: 'limit', type: 'int', default: 20, help: 'Number of comments (max 50)' },
    ],
    columns: ['rank', 'author', 'text', 'likes', 'replies', 'time'],
    func: async (page, kwargs) => {
        const count = Math.min(kwargs.limit || 20, 50);
        await page.goto('https://weibo.com');
        await page.wait(2);
        const id = String(kwargs.id);
        const data = await page.evaluate(`
      (async () => {
        const id = ${JSON.stringify(id)};
        const count = ${count};
        const strip = (html) => (html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();

        const url = '/ajax/statuses/buildComments?flow=0&is_reload=1&id=' + id + '&is_show_bulletin=2&is_mix=0&count=' + count;
        const resp = await fetch(url, {credentials: 'include'});
        if (!resp.ok) return {error: 'HTTP ' + resp.status};
        const data = await resp.json();
        if (!data.ok) return {error: 'API error: ' + (data.msg || 'unknown')};

        return (data.data || []).map((c, i) => {
          const item = {
            rank: i + 1,
            author: c.user?.screen_name || '',
            text: strip(c.text || ''),
            likes: c.like_count || 0,
            replies: c.total_number || 0,
            time: c.created_at || '',
          };
          if (c.reply_comment) {
            item.reply_to = (c.reply_comment.user?.screen_name || '') + ': ' + strip(c.reply_comment.text || '').substring(0, 80);
          }
          return item;
        });
      })()
    `);
        if (!Array.isArray(data))
            return [];
        return data;
    },
});
