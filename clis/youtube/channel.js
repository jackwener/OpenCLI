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

export function isShortsInput(input) {
    const raw = String(input || '').trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
    if (!raw)
        return false;
    try {
        const url = new URL(raw);
        return url.pathname.replace(/\/+$/, '').endsWith('/shorts');
    }
    catch { }
    return raw.endsWith('/shorts');
}

export function getChannelResolveUrl(input) {
    const raw = String(input || '').trim();
    if (!raw)
        return '';
    try {
        const url = new URL(raw);
        if (/^(www\.)?youtube\.com$/i.test(url.hostname) || /(^|\.)youtube\.com$/i.test(url.hostname))
            return url.origin + url.pathname.replace(/\/+$/, '');
        return '';
    }
    catch { }
    if (raw.startsWith('@'))
        return 'https://www.youtube.com/' + raw.replace(/^\/+/, '').replace(/\/+$/, '');
    if (raw.startsWith('/@') || raw.startsWith('/channel/'))
        return 'https://www.youtube.com' + raw.replace(/\/+$/, '');
    return '';
}

export function isShortsTab(tabEntry) {
    const tab = tabEntry?.tabRenderer;
    const url = tab?.endpoint?.commandMetadata?.webCommandMetadata?.url || '';
    return tab?.tabIdentifier === 'SHORTS'
        || url.replace(/\/+$/, '').endsWith('/shorts')
        || tab?.title === 'Shorts';
}

export function isVideosTab(tabEntry) {
    const tab = tabEntry?.tabRenderer;
    const url = tab?.endpoint?.commandMetadata?.webCommandMetadata?.url || '';
    return tab?.tabIdentifier === 'VIDEOS'
        || url.replace(/\/+$/, '').endsWith('/videos')
        || tab?.title === 'Videos';
}

export function extractShortsLockupVideo(item) {
    const lockup = item?.richItemRenderer?.content?.shortsLockupViewModel || item?.shortsLockupViewModel;
    if (!lockup)
        return null;
    const readText = (value) => {
        if (!value)
            return '';
        if (typeof value === 'string')
            return value;
        if (value.content)
            return String(value.content);
        if (value.simpleText)
            return String(value.simpleText);
        if (value.text)
            return String(value.text);
        if (Array.isArray(value.runs))
            return value.runs.map(run => run.text || '').join('');
        const label = value.accessibility?.accessibilityData?.label || value.accessibilityData?.label;
        return label ? String(label) : '';
    };
    const videoId = lockup.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId
        || lockup.onTap?.innertubeCommand?.watchEndpoint?.videoId
        || lockup.navigationEndpoint?.reelWatchEndpoint?.videoId
        || lockup.navigationEndpoint?.watchEndpoint?.videoId
        || lockup.inlinePlayerData?.onVisible?.innertubeCommand?.watchEndpoint?.videoId
        || lockup.videoId
        || lockup.contentId
        || String(lockup.entityId || '').replace(/^shorts-shelf-item-/, '');
    if (!videoId)
        return null;
    const accessibilityText = readText(lockup.accessibilityText);
    const title = readText(lockup.overlayMetadata?.primaryText)
        || readText(lockup.title)
        || accessibilityText.split(',')[0]
        || '';
    const views = readText(lockup.overlayMetadata?.secondaryText)
        || readText(lockup.viewCountText)
        || (accessibilityText.match(/([^,]+views?)/i)?.[1] || '');
    return {
        videoId,
        title,
        duration: 'Shorts',
        views,
        url: 'https://www.youtube.com/shorts/' + videoId,
    };
}

export function extractRichGridVideo(item) {
    const v = item?.richItemRenderer?.content?.videoRenderer;
    if (!v)
        return null;
    return {
        videoId: v.videoId || '',
        title: v.title?.runs?.[0]?.text || '',
        duration: v.lengthText?.simpleText || '',
        views: (v.shortViewCountText?.simpleText || '') + (v.publishedTimeText?.simpleText ? ' | ' + v.publishedTimeText.simpleText : ''),
        url: 'https://www.youtube.com/watch?v=' + v.videoId,
    };
}

export function formatChannelRows(result) {
    const videos = Array.isArray(result?.recentVideos) ? result.recentVideos : [];
    const info = { ...(result || {}) };
    delete info.recentVideos;
    // Keep the legacy field/value rows while preserving structured Shorts data for JSON consumers.
    const rows = Object.entries(info).map(([field, value]) => ({
        field,
        value: String(value),
    }));
    if (videos.length > 0) {
        const sectionLabel = videos.some(v => v.url?.includes('/shorts/')) ? '--- Shorts ---' : '--- Recent Videos ---';
        rows.push({ field: '---', value: sectionLabel });
        for (const v of videos) {
            const row = { field: v.title, value: `${v.duration} | ${v.views} | ${v.url}` };
            if (v.url?.includes('/shorts/')) {
                row.type = 'shorts';
                row.videoId = v.videoId || '';
                row.title = v.title || '';
                row.viewCount = v.views || '';
                row.url = v.url || '';
            }
            rows.push(row);
        }
    }
    return rows;
}

cli({
    site: 'youtube',
    name: 'channel',
    access: 'read',
    description: 'Get YouTube channel info and recent videos',
    domain: 'www.youtube.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'id', required: true, positional: true, help: 'Channel ID (UCxxxx), handle (@name), or channel URL' },
        { name: 'limit', type: 'int', default: 10, help: 'Max recent videos (max 30)' },
        { name: 'tab', default: '', help: 'Channel tab to list: videos or shorts' },
    ],
    columns: ['field', 'value'],
    func: async (page, kwargs) => {
        const channelId = String(kwargs.id);
        const limit = Math.min(kwargs.limit || 10, 30);
        const tab = String(kwargs.tab || '').toLowerCase();
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
        const requestedTab = ${JSON.stringify(tab)};
        const extractSelectedRichGridContents = ${extractSelectedRichGridContents.toString()};
        const isShortsInput = ${isShortsInput.toString()};
        const getChannelResolveUrl = ${getChannelResolveUrl.toString()};
        const isShortsTab = ${isShortsTab.toString()};
        const isVideosTab = ${isVideosTab.toString()};
        const extractShortsLockupVideo = ${extractShortsLockupVideo.toString()};
        const extractRichGridVideo = ${extractRichGridVideo.toString()};

        // Resolve handles and channel URLs to the browseId used by InnerTube.
        let browseId = channelId;
        let resolvedTabParams = '';
        const resolveUrl = getChannelResolveUrl(channelId);
        if (resolveUrl) {
          const resolveResp = await fetch('/youtubei/v1/navigation/resolve_url?key=' + apiKey + '&prettyPrint=false', {
            method: 'POST', credentials: 'include',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({context, url: resolveUrl})
          });
          if (resolveResp.ok) {
            const resolveData = await resolveResp.json();
            const browseEndpoint = resolveData.endpoint?.browseEndpoint;
            browseId = browseEndpoint?.browseId || channelId;
            resolvedTabParams = browseEndpoint?.params || '';
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
        const wantsShorts = requestedTab === 'shorts' || isShortsInput(channelId);
        const wantsVideos = requestedTab === 'videos';

        if (!wantsShorts && !wantsVideos && homeTab) {
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

        // If Home tab has no videos, or --tab videos was requested, try Videos tab.
        if (!wantsShorts && (wantsVideos || recentVideos.length === 0)) {
          const videosTab = tabs.find(isVideosTab);
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
                const video = extractRichGridVideo(item);
                if (video) recentVideos.push(video);
              }
            }
          }
        }

        if (wantsShorts) {
          const shortsTab = tabs.find(isShortsTab);
          const shortsTabParams = shortsTab?.tabRenderer?.endpoint?.browseEndpoint?.params || resolvedTabParams;
          const collectShorts = (richGrid) => {
            for (const item of (richGrid || [])) {
              if (recentVideos.length >= limit) break;
              const video = extractShortsLockupVideo(item);
              if (video) recentVideos.push(video);
            }
          };
          if (shortsTabParams) {
            const shortsResp = await fetch('/youtubei/v1/browse?key=' + apiKey + '&prettyPrint=false', {
              method: 'POST', credentials: 'include',
              headers: {'Content-Type': 'application/json'},
              body: JSON.stringify({context, browseId, params: shortsTabParams})
            });
            if (shortsResp.ok) {
              const shortsData = await shortsResp.json();
              collectShorts(extractSelectedRichGridContents(shortsData));
            }
          }
          if (recentVideos.length === 0) {
            collectShorts(extractSelectedRichGridContents(data));
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
        return formatChannelRows(data);
    },
});

export const __test__ = {
    extractSelectedRichGridContents,
    extractRichGridVideo,
    extractShortsLockupVideo,
    formatChannelRows,
    getChannelResolveUrl,
    isShortsInput,
    isShortsTab,
    isVideosTab,
};
