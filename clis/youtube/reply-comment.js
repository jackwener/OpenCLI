/**
 * YouTube reply-comment — reply to a specific comment on a video.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { parseVideoId } from './utils.js';

cli({
    site: 'youtube',
    name: 'reply-comment',
    access: 'write',
    description: 'Reply to a specific YouTube comment',
    domain: 'www.youtube.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'comment-id', required: true, positional: true, help: 'Comment ID (Ugxxx format from youtube comments output)' },
        { name: 'text', required: true, positional: true, help: 'Reply text' },
        { name: 'url', required: true, help: 'Video URL (needed for context)' },
    ],
    columns: ['status', 'message', 'comment_id', 'text'],
    func: async (page, kwargs) => {
        const videoId = parseVideoId(kwargs.url);
        const commentId = String(kwargs['comment-id']);
        const text = String(kwargs.text);

        await page.goto(`https://www.youtube.com/watch?v=${videoId}`);
        await page.wait(3);

        const result = await page.evaluate(`(async () => {
      try {
        var videoId = ${JSON.stringify(videoId)};
        var commentId = ${JSON.stringify(commentId)};
        var replyText = ${JSON.stringify(text)};
        var cfg = window.ytcfg?.data_ || {};
        var apiKey = cfg.INNERTUBE_API_KEY;
        var context = cfg.INNERTUBE_CONTEXT;
        if (!apiKey || !context) return { ok: false, message: 'YouTube config not found — are you logged in?' };

        function encodeVarint(val) {
          var bytes = [];
          while (val > 0x7f) { bytes.push((val & 0x7f) | 0x80); val >>>= 7; }
          bytes.push(val & 0x7f);
          return bytes;
        }
        function encodeString(fieldNum, str) {
          var tag = encodeVarint((fieldNum << 3) | 2);
          var encoded = new TextEncoder().encode(str);
          var len = encodeVarint(encoded.length);
          var result = new Uint8Array(tag.length + len.length + encoded.length);
          result.set(tag, 0);
          result.set(len, tag.length);
          result.set(encoded, tag.length + len.length);
          return result;
        }
        function encodeVarintField(fieldNum, val) {
          var tag = encodeVarint((fieldNum << 3) | 0);
          var v = encodeVarint(val);
          var result = new Uint8Array(tag.length + v.length);
          result.set(tag, 0);
          result.set(v, tag.length);
          return result;
        }

        var parts = [encodeString(2, videoId), encodeString(3, commentId), encodeVarintField(5, 0), encodeVarintField(6, 1)];
        var totalLen = parts.reduce(function(s, p) { return s + p.length; }, 0);
        var buf = new Uint8Array(totalLen);
        var offset = 0;
        for (var p of parts) { buf.set(p, offset); offset += p.length; }
        var createReplyParams = btoa(String.fromCharCode.apply(null, buf));

        var resp = await fetch('/youtubei/v1/comment/create_comment?key=' + apiKey + '&prettyPrint=false', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            context,
            commentText: replyText,
            createCommentParams: createReplyParams,
          }),
        });
        if (resp.status === 403) return { ok: false, message: 'No permission to reply — make sure you are logged into YouTube and can comment on this video' };
        if (!resp.ok) return { ok: false, message: 'Failed to post reply: HTTP ' + resp.status };
        var data = await resp.json();
        if (data.error) return { ok: false, message: data.error.message || 'YouTube API error' };
        if (data.actionResult?.status === 'STATUS_SUCCEEDED' || data.actions?.length > 0) {
          return { ok: true, message: 'Reply posted successfully' };
        }
        return { ok: false, message: 'Unexpected response — reply may not have been posted' };
      } catch (e) {
        return { ok: false, message: e.toString() };
      }
    })()`);

        return [{
            status: result.ok ? 'success' : 'failed',
            message: result.message,
            comment_id: commentId,
            text,
        }];
    },
});
