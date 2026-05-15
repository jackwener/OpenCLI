/**
 * Bilibili reply — reply to a specific video comment via /x/v2/reply/add.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { resolveBvid, apiGet } from './utils.js';

cli({
    site: 'bilibili',
    name: 'reply',
    access: 'write',
    description: '回复 B站视频评论',
    domain: 'www.bilibili.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'comment-id', required: true, positional: true, help: 'Comment rpid from bilibili comments output' },
        { name: 'text', required: true, positional: true, help: 'Reply text' },
        { name: 'bvid', required: true, help: 'Video BV ID (e.g. BV1WtAGzYEBm)' },
    ],
    columns: ['status', 'message', 'comment_id', 'text'],
    func: async (page, kwargs) => {
        const rpid = String(kwargs['comment-id']);
        const text = String(kwargs.text);
        const bvid = await resolveBvid(kwargs.bvid);

        const view = await apiGet(page, '/x/web-interface/view', { params: { bvid } });
        const aid = view?.data?.aid;
        if (!aid)
            throw new CommandExecutionError(`Cannot resolve aid for bvid: ${bvid}`);

        let message;
        try {
            message = await page.evaluate(`(async () => {
        var aid = ${JSON.stringify(String(aid))};
        var rpid = ${JSON.stringify(rpid)};
        var message = ${JSON.stringify(text)};
        var csrf = '';
        var cookies = document.cookie.split(';');
        for (var i = 0; i < cookies.length; i++) {
          var c = cookies[i].trim();
          if (c.startsWith('bili_jct=')) {
            csrf = c.split('=')[1];
            break;
          }
        }
        if (!csrf) throw new Error('No bili_jct CSRF token found — are you logged in?');

        var body = new URLSearchParams({
          oid: aid,
          type: '1',
          root: rpid,
          parent: rpid,
          message: message,
          csrf: csrf,
        });

        var res = await fetch('https://api.bilibili.com/x/v2/reply/add', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        });

        if (!res.ok) throw new Error('HTTP ' + res.status);
        var data = await res.json();
        if (data.code === 0) return 'Reply posted successfully';
        throw new Error('Bilibili API rejected reply: code=' + data.code + ' message=' + String(data.message || ''));
    })()`);
        } catch (err) {
            throw new CommandExecutionError(`Failed to post Bilibili reply: ${err instanceof Error ? err.message : String(err)}`);
        }

        return [{
            status: 'success',
            message,
            comment_id: rpid,
            text,
        }];
    },
});
