/**
 * Instagram reply — reply to a specific comment on one of a user's recent posts.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';

cli({
    site: 'instagram',
    name: 'reply',
    access: 'write',
    description: 'Reply to a specific Instagram comment',
    domain: 'www.instagram.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'username', type: 'string', required: true, positional: true, help: 'Username of the post author' },
        { name: 'comment-id', type: 'string', required: true, positional: true, help: 'Comment ID (pk from get-comments output)' },
        { name: 'text', type: 'string', required: true, positional: true, help: 'Reply text' },
        { name: 'index', type: 'int', default: 1, help: 'Post index (1 = most recent)' },
    ],
    columns: ['status', 'message', 'comment_id', 'text'],
    func: async (page, kwargs) => {
        const username = String(kwargs.username);
        const commentId = String(kwargs['comment-id']);
        const text = String(kwargs.text);
        const index = Math.max(1, Number(kwargs.index ?? 1));
        await page.goto('https://www.instagram.com');

        return page.evaluate(`(async () => {
      const username = ${JSON.stringify(username)};
      const commentId = ${JSON.stringify(commentId)};
      const replyText = ${JSON.stringify(text)};
      const idx = ${index} - 1;
      const headers = { 'X-IG-App-ID': '936619743392459' };
      const opts = { credentials: 'include', headers };

      const userRes = await fetch('https://www.instagram.com/api/v1/users/web_profile_info/?username=' + encodeURIComponent(username), opts);
      if (!userRes.ok) throw new Error('User not found: ' + username);
      const userId = (await userRes.json())?.data?.user?.id;
      const feedRes = await fetch('https://www.instagram.com/api/v1/feed/user/' + userId + '/?count=' + (idx + 1), opts);
      const posts = (await feedRes.json())?.items || [];
      if (idx >= posts.length) throw new Error('Post index ' + (idx + 1) + ' not found');
      const mediaPk = posts[idx].pk;
      const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '';

      const resp = await fetch('https://www.instagram.com/api/v1/web/comments/' + mediaPk + '/add/', {
        method: 'POST',
        credentials: 'include',
        headers: {
          ...headers,
          'X-CSRFToken': csrf,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'comment_text=' + encodeURIComponent(replyText) + '&replied_to_comment_id=' + encodeURIComponent(commentId),
      });
      if (!resp.ok) throw new Error('Failed to reply: HTTP ' + resp.status);
      return [{ status: 'success', message: 'Reply posted', comment_id: commentId, text: replyText }];
    })()`);
    },
});
