/**
 * YouTube comments — get video comments via InnerTube API.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { parseVideoId } from './utils.js';
cli({
    site: 'youtube',
    name: 'comments',
    access: 'read',
    description: 'Get YouTube video comments',
    domain: 'www.youtube.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'url', required: true, positional: true, help: 'YouTube video URL or video ID' },
        { name: 'limit', type: 'int', default: 20, help: 'Max comments (max 100)' },
    ],
    columns: ['rank', 'comment_id', 'author', 'text', 'likes', 'replies', 'time'],
    func: async (page, kwargs) => {
        const videoId = parseVideoId(kwargs.url);
        const limit = Math.min(kwargs.limit || 20, 100);
        await page.goto(`https://www.youtube.com/watch?v=${videoId}`);
        await page.wait(3);
        const data = await page.evaluate(`
      (async () => {
        const videoId = ${JSON.stringify(videoId)};
        const limit = ${limit};
        const cfg = window.ytcfg?.data_ || {};
        const apiKey = cfg.INNERTUBE_API_KEY;
        const context = cfg.INNERTUBE_CONTEXT;
        if (!apiKey || !context) return {error: 'YouTube config not found'};

        // Step 1: Get comment continuation token
        let continuationToken = null;

        // Try from current page ytInitialData
        if (window.ytInitialData) {
          const results = window.ytInitialData.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];
          const commentSection = results.find(i => i.itemSectionRenderer?.targetId === 'comments-section');
          continuationToken = commentSection?.itemSectionRenderer?.contents?.[0]?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
        }

        // Fallback: fetch via next API
        if (!continuationToken) {
          const nextResp = await fetch('/youtubei/v1/next?key=' + apiKey + '&prettyPrint=false', {
            method: 'POST', credentials: 'include',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({context, videoId})
          });
          if (!nextResp.ok) return {error: 'Failed to get video data: HTTP ' + nextResp.status};
          const nextData = await nextResp.json();
          const results = nextData.contents?.twoColumnWatchNextResults?.results?.results?.contents || [];
          const commentSection = results.find(i => i.itemSectionRenderer?.targetId === 'comments-section');
          continuationToken = commentSection?.itemSectionRenderer?.contents?.[0]?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
        }

        if (!continuationToken) return {error: 'No comment section found — comments may be disabled'};

        // Step 2: Fetch comments
        const commentResp = await fetch('/youtubei/v1/next?key=' + apiKey + '&prettyPrint=false', {
          method: 'POST', credentials: 'include',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({context, continuation: continuationToken})
        });
        if (!commentResp.ok) return {error: 'Failed to fetch comments: HTTP ' + commentResp.status};
        const commentData = await commentResp.json();

        var commentIds = [];
        var endpoints = commentData.onResponseReceivedEndpoints || [];
        for (var ei = 0; ei < endpoints.length; ei++) {
          var ep = endpoints[ei];
          var items = ep.reloadContinuationItemsCommand?.continuationItems
            || ep.appendContinuationItemsAction?.continuationItems || [];
          for (var ii = 0; ii < items.length; ii++) {
            var thread = items[ii].commentThreadRenderer;
            if (!thread) continue;
            var commentId = thread.commentViewModel?.commentViewModel?.commentId
              || thread.comment?.commentRenderer?.commentId
              || '';
            if (commentId) commentIds.push(commentId);
          }
        }

        // Parse from frameworkUpdates (new ViewModel format)
        var mutations = commentData.frameworkUpdates?.entityBatchUpdate?.mutations || [];
        var commentEntities = mutations.filter(function(m) { return m.payload?.commentEntityPayload; });

        var results = [];
        var count = commentEntities.length < limit ? commentEntities.length : limit;
        for (var ci = 0; ci < count; ci++) {
          var m = commentEntities[ci];
          var p = m.payload.commentEntityPayload;
          var props = p.properties || {};
          var author = p.author || {};
          var toolbar = p.toolbar || {};
          var cid = commentIds[ci] || m.entityKey || m.key || props.commentId || ('yt-comment-' + (ci + 1));
          results.push({
            rank: ci + 1,
            comment_id: '' + cid,
            author: author.displayName || '',
            text: (props.content?.content || '').substring(0, 300),
            likes: toolbar.likeCountNotliked || '0',
            replies: toolbar.replyCount || '0',
            time: props.publishedTime || '',
          });
        }
        return results;
      })()
    `);
        if (!Array.isArray(data)) {
            const errMsg = data && typeof data === 'object' ? String(data.error || '') : '';
            if (errMsg)
                throw new CommandExecutionError(errMsg);
            return [];
        }
        return data;
    },
});
