/**
 * Douyin reply — reply to a specific comment through the page-context API.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';

function parseAwemeId(input) {
    const raw = String(input || '').trim();
    const match = raw.match(/\/video\/(\d+)/);
    if (match)
        return match[1];
    if (/^\d+$/.test(raw))
        return raw;
    throw new CommandExecutionError(`Cannot parse aweme_id from: ${raw}`);
}

cli({
    site: 'douyin',
    name: 'reply',
    access: 'write',
    description: '回复抖音视频评论',
    domain: 'www.douyin.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'url', required: true, positional: true, help: 'Douyin video URL or aweme_id' },
        { name: 'comment-id', required: true, positional: true, help: 'Comment ID (cid from get-comments output)' },
        { name: 'text', required: true, positional: true, help: 'Reply text' },
    ],
    columns: ['status', 'message', 'comment_id', 'text'],
    func: async (page, kwargs) => {
        const awemeId = parseAwemeId(kwargs.url);
        const commentId = String(kwargs['comment-id']);
        const text = String(kwargs.text);

        await page.goto('https://www.douyin.com');
        await page.wait(3);

        let message;
        try {
            message = await page.evaluate(`(async () => {
        var awemeId = ${JSON.stringify(awemeId)};
        var commentId = ${JSON.stringify(commentId)};
        var replyText = ${JSON.stringify(text)};
        var params = new URLSearchParams({
          aweme_id: awemeId,
          text: replyText,
          reply_id: commentId,
          aid: '6383',
        });
        var res = await fetch('https://www.douyin.com/aweme/v1/web/comment/publish/?' + params.toString(), {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            referer: 'https://www.douyin.com/',
          },
        });
        var data = await res.json();
        if (data.status_code === 0) return 'Reply posted successfully';
        throw new Error('Douyin API rejected reply: ' + String(data.status_msg || data.status_code || ''));
    })()`);
        } catch (err) {
            throw new CommandExecutionError(`Failed to post Douyin reply: ${err instanceof Error ? err.message : String(err)}`);
        }

        return [{
            status: 'success',
            message,
            comment_id: commentId,
            text,
        }];
    },
});
