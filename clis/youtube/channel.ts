/**
 * YouTube channel — get channel info and recent videos via InnerTube API.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';

cli({
  site: 'youtube',
  name: 'channel',
  description: 'Get YouTube channel info and recent videos',
  domain: 'www.youtube.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'id', required: true, positional: true, help: 'Channel ID (UCxxxx) or handle (@name)' },
    { name: 'limit', type: 'int', default: 10, help: 'Max recent videos (max 30)' },
  ],
  columns: ['field', 'value'],
  func: async (page, kwargs) => {
    const channelId = String(kwargs.id);
    const limit = Math.min(kwargs.limit || 10, 30);
    await page.goto('https://www.youtube.com');
    await page.wait(2);

    const data = await page.evaluate(`
      (async () => {
        const channelId = ${JSON.stringify(channelId)};
        const limit = ${limit};
        const cfg = window.ytcfg?.data_ || {};
        const apiKey = cfg.INNERTUBE_API_KEY;
        const context = cfg.INNERTUBE_CONTEXT;
        if (!apiKey || !context) return {error: 'YouTube config not found'};

        // Resolve handle to browseId if needed
        let browseId = channelId;
        if (channelId.startsWith('@')) {
          const resolveResp = await fetch('/youtubei/v1/navigation/resolve_url?key=' + apiKey + '&prettyPrint=false', {
            method: 'POST', credentials: 'include',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({context, url: 'https://www.youtube.com/' + channelId})
          });
          if (resolveResp.ok) {
            const resolveData = await resolveResp.json();
            browseId = resolveData.endpoint?.browseEndpoint?.browseId || channelId;
          }
        }

        // Fetch channel data
        const resp = await fetch('/youtubei/v1/browse?key=' + apiKey + '&prettyPrint=false', {
          method: 'POST', credentials: 'include',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({context, browseId})
        });
        if (!resp.ok) return {error: 'Channel API returned HTTP ' + resp.status};
        const data = await resp.json();

        // Channel metadata
        const metadata = data.metadata?.channelMetadataRenderer || {};
        const header = data.header?.pageHeaderRenderer || data.header?.c4TabbedHeaderRenderer || {};

        // Subscriber count from header
        let subscriberCount = '';
        try {
          const rows = header.content?.pageHeaderViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [];
          for (const row of rows) {
            for (const part of (row.metadataParts || [])) {
              const text = part.text?.content || '';
              if (text.includes('subscriber')) subscriberCount = text;
            }
          }
        } catch {}
        // Fallback for old c4TabbedHeaderRenderer format
        if (!subscriberCount && header.subscriberCountText?.simpleText) {
          subscriberCount = header.subscriberCountText.simpleText;
        }

        // Extract recent videos from Home tab
        const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
        const homeTab = tabs.find(t => t.tabRenderer?.selected);
        const recentVideos = [];

        if (homeTab) {
          const sections = homeTab.tabRenderer?.content?.sectionListRenderer?.contents || [];
          for (const section of sections) {
            for (const shelf of (section.itemSectionRenderer?.contents || [])) {
              for (const item of (shelf.shelfRenderer?.content?.horizontalListRenderer?.items || [])) {
                // New lockupViewModel format
                const lvm = item.lockupViewModel;
                if (lvm && lvm.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO' && recentVideos.length < limit) {
                  const meta = lvm.metadata?.lockupMetadataViewModel;
                  const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
                  const viewsAndTime = (rows[0]?.metadataParts || []).map(p => p.text?.content).filter(Boolean).join(' | ');
                  let duration = '';
                  for (const ov of (lvm.contentImage?.thumbnailViewModel?.overlays || [])) {
                    for (const b of (ov.thumbnailBottomOverlayViewModel?.badges || [])) {
                      if (b.thumbnailBadgeViewModel?.text) duration = b.thumbnailBadgeViewModel.text;
                    }
                  }
                  recentVideos.push({
                    title: meta?.title?.content || '',
                    duration,
                    views: viewsAndTime,
                    url: 'https://www.youtube.com/watch?v=' + lvm.contentId,
                  });
                }
                // Legacy gridVideoRenderer format
                if (item.gridVideoRenderer && recentVideos.length < limit) {
                  const v = item.gridVideoRenderer;
                  recentVideos.push({
                    title: v.title?.runs?.[0]?.text || v.title?.simpleText || '',
                    duration: v.thumbnailOverlays?.[0]?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText || '',
                    views: (v.shortViewCountText?.simpleText || '') + (v.publishedTimeText?.simpleText ? ' | ' + v.publishedTimeText.simpleText : ''),
                    url: 'https://www.youtube.com/watch?v=' + v.videoId,
                  });
                }
              }
            }
          }
        }

        return {
          name: metadata.title || '',
          channelId: metadata.externalId || browseId,
          handle: metadata.vanityChannelUrl?.split('/').pop() || '',
          description: (metadata.description || '').substring(0, 500),
          subscribers: subscriberCount,
          url: metadata.channelUrl || 'https://www.youtube.com/channel/' + browseId,
          keywords: metadata.keywords || '',
          recentVideos,
        };
      })()
    `);

    if (!data || typeof data !== 'object') throw new CommandExecutionError('Failed to fetch channel data');
    if ((data as Record<string, unknown>).error) throw new CommandExecutionError(String((data as Record<string, unknown>).error));

    const result = data as Record<string, unknown>;
    const videos = result.recentVideos as Array<Record<string, string>> | undefined;
    delete result.recentVideos;

    // Channel info as field/value pairs + recent videos as table
    const rows = Object.entries(result).map(([field, value]) => ({
      field,
      value: String(value),
    }));

    if (videos && videos.length > 0) {
      rows.push({ field: '---', value: '--- Recent Videos ---' });
      for (const v of videos) {
        rows.push({ field: v.title, value: `${v.duration} | ${v.views} | ${v.url}` });
      }
    }

    return rows;
  },
});
