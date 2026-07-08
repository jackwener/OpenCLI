/**
 * YouTube feed — homepage recommended videos.
 * Reads ytInitialData from the homepage directly (personalized, no separate API call needed).
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

cli({
    site: 'youtube',
    name: 'feed',
    access: 'read',
    description: 'Get YouTube homepage recommended videos',
    domain: 'www.youtube.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Max videos to return (default 20, max 100)' },
    ],
    columns: ['rank', 'title', 'channel', 'video_id', 'views', 'duration', 'published', 'url'],
    func: async (page, kwargs) => {
        const limit = Math.min(kwargs.limit || 20, 100);
        await page.goto('https://www.youtube.com');
        await page.wait(3);
        const data = await page.evaluate(`
      (async () => {
        const d = window.ytInitialData;
        if (!d) return { error: 'YouTube data not found — are you logged in?' };

        const limit = ${limit};
        const cfg = window.ytcfg?.data_ || {};
        const apiKey = cfg.INNERTUBE_API_KEY;
        const context = cfg.INNERTUBE_CONTEXT;

        function extractFromItem(item) {
          // Modern lockupViewModel format
          const lvm = item.richItemRenderer?.content?.lockupViewModel;
          if (lvm && lvm.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
            const meta = lvm.metadata?.lockupMetadataViewModel;
            const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
            const parts = rows.flatMap(r => (r.metadataParts || []).map(p => p.text?.content || '').filter(Boolean));
            let duration = '';
            for (const ov of (lvm.contentImage?.thumbnailViewModel?.overlays || [])) {
              for (const b of (ov.thumbnailBottomOverlayViewModel?.badges || [])) {
                if (b.thumbnailBadgeViewModel?.text) duration = b.thumbnailBadgeViewModel.text;
              }
            }
            return {
              title: meta?.title?.content || '',
              channel: parts[0] || '',
              views: parts[1] || '',
              duration,
              published: parts[2] || '',
              video_id: lvm.contentId,
            };
          }

          // Legacy videoRenderer format
          const v = item.richItemRenderer?.content?.videoRenderer || item.videoRenderer;
          if (v?.videoId) {
            return {
              title: v.title?.runs?.[0]?.text || '',
              channel: v.ownerText?.runs?.[0]?.text || v.shortBylineText?.runs?.[0]?.text || '',
              views: v.viewCountText?.simpleText || v.shortViewCountText?.simpleText || '',
              duration: v.lengthText?.simpleText || '',
              published: v.publishedTimeText?.simpleText || '',
              video_id: v.videoId,
            };
          }
          return null;
        }

        const tabs = d.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
        const richContents = tabs[0]?.tabRenderer?.content?.richGridRenderer?.contents || [];

        const videos = [];
        for (const item of richContents) {
          if (videos.length >= limit) break;
          const v = extractFromItem(item);
          if (v?.video_id) {
            videos.push({ rank: videos.length + 1, ...v, url: 'https://www.youtube.com/watch?v=' + v.video_id });
          }
        }

        // Pagination
        if (videos.length < limit && apiKey && context) {
          let contItem = richContents[richContents.length - 1];
          while (videos.length < limit && contItem?.continuationItemRenderer) {
            const token = contItem.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
            if (!token) break;
            const resp = await fetch('/youtubei/v1/browse?key=' + apiKey + '&prettyPrint=false', {
              method: 'POST', credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ context, continuation: token }),
            });
            if (!resp.ok) break;
            const contData = await resp.json();
            const newItems = contData.onResponseReceivedActions?.[0]?.appendContinuationItemsAction?.continuationItems || [];
            if (!newItems.length) break;
            for (const item of newItems) {
              if (videos.length >= limit) break;
              const v = extractFromItem(item);
              if (v?.video_id) {
                videos.push({ rank: videos.length + 1, ...v, url: 'https://www.youtube.com/watch?v=' + v.video_id });
              }
            }
            contItem = newItems[newItems.length - 1];
          }
        }

        return videos;
      })()
    `);
        if (!Array.isArray(data)) {
            const errMsg = data && typeof data === 'object' ? String(data.error || '') : '';
            throw new CommandExecutionError(errMsg || 'Failed to fetch YouTube feed');
        }
        if (data.length === 0) {
            throw new EmptyResultError('youtube feed');
        }
        return data;
    },
});
