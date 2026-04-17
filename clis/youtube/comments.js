/**
 * YouTube comments — get video comments via InnerTube API.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';
import { parseVideoId } from './utils.js';
cli({
    site: 'youtube',
    name: 'comments',
    description: 'Get YouTube video comments',
    domain: 'www.youtube.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'url', required: true, positional: true, help: 'YouTube video URL or video ID' },
        { name: 'limit', type: 'int', default: 20, help: 'Max comments (max 100)' },
    ],
    columns: ['rank', 'author', 'text', 'likes', 'replies', 'time'],
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

        // Parse from frameworkUpdates (new ViewModel format)
        const mutations = commentData.frameworkUpdates?.entityBatchUpdate?.mutations || [];
        const commentEntities = mutations.filter(m => m.payload?.commentEntityPayload);

        return commentEntities.slice(0, limit).map((m, i) => {
          const p = m.payload.commentEntityPayload;
          const props = p.properties || {};
          const author = p.author || {};
          const toolbar = p.toolbar || {};
          return {
            rank: i + 1,
            author: author.displayName || '',
            text: (props.content?.content || '').substring(0, 300),
            likes: toolbar.likeCountNotliked || '0',
            replies: toolbar.replyCount || '0',
            time: props.publishedTime || '',
          };
        });
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
