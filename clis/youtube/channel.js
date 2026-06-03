/**
 * YouTube channel — get channel info and recent videos via InnerTube API.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError } from '@jackwener/opencli/errors';

export function extractSelectedRichGridContents(browseData) {
    const tabs = browseData?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
    const readRichGrid = (tab) => tab?.tabRenderer?.content?.richGridRenderer?.contents;
    const selectedTab = tabs.find(t => t?.tabRenderer?.selected);
    const selectedContents = readRichGrid(selectedTab);
    if (Array.isArray(selectedContents))
        return selectedContents;
    const fallbackContents = readRichGrid(tabs.find(t => {
        const contents = readRichGrid(t);
        return Array.isArray(contents) && contents.length > 0;
    })) || readRichGrid(tabs.find(t => Array.isArray(readRichGrid(t))));
    return Array.isArray(fallbackContents) ? fallbackContents : [];
}

export function parseVideoItem(item) {
    const content = item?.richItemRenderer?.content || item || {};
    const normalizeId = (value) => {
        const id = String(value || '').trim();
        return /^[A-Za-z0-9_-]+$/.test(id) ? id : '';
    };
    // New lockupViewModel format
    const lvm = content.lockupViewModel;
    if (lvm && lvm.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
        const id = normalizeId(lvm.contentId);
        const meta = lvm.metadata?.lockupMetadataViewModel;
        const title = meta?.title?.content || '';
        if (!id || !title)
            return null;
        const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
        const parts = (rows[0]?.metadataParts || []).map(p => p.text?.content).filter(Boolean);
        let duration = '';
        for (const ov of (lvm.contentImage?.thumbnailViewModel?.overlays || [])) {
            for (const b of (ov.thumbnailBottomOverlayViewModel?.badges || [])) {
                if (b.thumbnailBadgeViewModel?.text) duration = b.thumbnailBadgeViewModel.text;
            }
        }
        return {
            title,
            duration,
            views: parts.join(' | '),
            url: 'https://www.youtube.com/watch?v=' + id,
        };
    }
    // Legacy videoRenderer format
    const v = content.videoRenderer || content.gridVideoRenderer;
    if (v) {
        const id = normalizeId(v.videoId);
        const title = v.title?.runs?.[0]?.text || v.title?.simpleText || '';
        if (!id || !title)
            return null;
        return {
            title,
            duration: v.lengthText?.simpleText || v.thumbnailOverlays?.find(o => o.thumbnailOverlayTimeStatusRenderer)?.thumbnailOverlayTimeStatusRenderer?.text?.simpleText || '',
            views: (v.shortViewCountText?.simpleText || '') + (v.publishedTimeText?.simpleText ? ' | ' + v.publishedTimeText.simpleText : ''),
            url: 'https://www.youtube.com/watch?v=' + id,
        };
    }
    return null;
}

cli({
    site: 'youtube',
    name: 'channel',
    access: 'read',
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
        const extractSelectedRichGridContents = ${extractSelectedRichGridContents.toString()};
        const parseVideoItem = ${parseVideoItem.toString()};

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
                if (recentVideos.length < limit) {
                  const parsed = parseVideoItem(item);
                  if (parsed) recentVideos.push(parsed);
                }
              }
            }
          }
        }

        // If Home tab has no videos, try Videos tab
        if (recentVideos.length === 0) {
          const videosTab = tabs.find(t => {
            const tab = t.tabRenderer;
            const url = tab?.endpoint?.commandMetadata?.webCommandMetadata?.url || '';
            return tab?.tabIdentifier === 'VIDEOS'
              || url.endsWith('/videos')
              || tab?.title === 'Videos';
          });
          const videosTabParams = videosTab?.tabRenderer?.endpoint?.browseEndpoint?.params;
          if (videosTabParams) {
            const videosResp = await fetch('/youtubei/v1/browse?key=' + apiKey + '&prettyPrint=false', {
              method: 'POST', credentials: 'include',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({context, browseId, params: videosTabParams})
            });
            if (videosResp.ok) {
              const videosData = await videosResp.json();
              // The InnerTube response includes ALL tabs (Home/Videos/Shorts/...),
              // not just the requested one. Prefer the selected tab, but keep
              // older single-tab responses working when YouTube omits selected.
              const richGrid = extractSelectedRichGridContents(videosData);
              for (const item of richGrid) {
                if (recentVideos.length >= limit) break;
                const parsed = parseVideoItem(item);
                if (parsed) {
                  recentVideos.push(parsed);
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
        if (!data || typeof data !== 'object')
            throw new CommandExecutionError('Failed to fetch channel data');
        if (data.error)
            throw new CommandExecutionError(String(data.error));
        const result = data;
        const videos = result.recentVideos;
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

export const __test__ = {
    extractSelectedRichGridContents,
    parseVideoItem,
};
