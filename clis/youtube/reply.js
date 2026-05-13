/**
 * YouTube reply — post a top-level comment on a video.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { parseVideoId } from './utils.js';

cli({
    site: 'youtube',
    name: 'reply',
    access: 'write',
    description: 'Post a comment on a YouTube video',
    domain: 'www.youtube.com',
    strategy: Strategy.COOKIE,
    browser: true,
    args: [
        { name: 'url', required: true, positional: true, help: 'YouTube video URL or video ID' },
        { name: 'text', required: true, positional: true, help: 'Comment text' },
    ],
    columns: ['status', 'message', 'text'],
    func: async (page, kwargs) => {
        const videoId = parseVideoId(kwargs.url);
        const text = String(kwargs.text);

        await page.goto(`https://www.youtube.com/watch?v=${videoId}`);
        await page.wait(3);

        const result = await page.evaluate(`(async () => {
      try {
        var videoId = ${JSON.stringify(videoId)};
        var commentText = ${JSON.stringify(text)};
        var cfg = window.ytcfg?.data_ || {};
        var apiKey = cfg.INNERTUBE_API_KEY;
        var context = cfg.INNERTUBE_CONTEXT;
        if (!apiKey || !context) return { ok: false, message: 'YouTube config not found — are you logged in?' };

        var createParams = null;
        var continuation = null;
        if (window.ytInitialData) {
          var results = window.ytInitialData.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];
          var commentSection = results.find(function(i) { return i.itemSectionRenderer?.targetId === 'comments-section'; });
          continuation = commentSection?.itemSectionRenderer?.contents?.[0]?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
        }
        if (continuation) {
          var contResp = await fetch('/youtubei/v1/next?key=' + apiKey + '&prettyPrint=false', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ context, continuation }),
          });
          if (contResp.ok) {
            var contData = await contResp.json();
            var eps = contData.onResponseReceivedEndpoints || [];
            for (var ep of eps) {
              var items = ep.reloadContinuationItemsCommand?.continuationItems || [];
              for (var item of items) {
                var renderer = item.commentsHeaderRenderer;
                createParams = renderer?.createRenderer?.commentSimpleboxRenderer?.submitButton?.buttonRenderer?.serviceEndpoint?.createCommentEndpoint?.createCommentParams;
                if (createParams) break;
              }
              if (createParams) break;
            }
          }
        }

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
        if (!createParams) {
          var parts = [encodeString(2, videoId), encodeVarintField(5, 0), encodeVarintField(6, 1)];
          var totalLen = parts.reduce(function(s, p) { return s + p.length; }, 0);
          var buf = new Uint8Array(totalLen);
          var offset = 0;
          for (var p of parts) { buf.set(p, offset); offset += p.length; }
          createParams = btoa(String.fromCharCode.apply(null, buf));
        }

        var resp = await fetch('/youtubei/v1/comment/create_comment?key=' + apiKey + '&prettyPrint=false', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context, commentText, createCommentParams: createParams }),
        });
        if (resp.status === 403) return { ok: false, message: 'No permission to comment — make sure you are logged into YouTube and can comment on this video' };
        if (!resp.ok) return { ok: false, message: 'Failed to post comment: HTTP ' + resp.status };
        var data = await resp.json();
        if (data.error) return { ok: false, message: data.error.message || 'YouTube API error' };
        if (data.actionResult?.status === 'STATUS_SUCCEEDED' || data.actions?.length > 0) {
          return { ok: true, message: 'Comment posted successfully' };
        }
        return { ok: false, message: 'Unexpected response — comment may not have been posted' };
      } catch (e) {
        return { ok: false, message: e.toString() };
      }
    })()`);

        return [{ status: result.ok ? 'success' : 'failed', message: result.message, text }];
    },
});
