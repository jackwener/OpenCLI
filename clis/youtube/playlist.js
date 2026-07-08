/**
 * YouTube playlist — get playlist info and video list via InnerTube browse API.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { prepareYoutubeApiPage, FETCH_BROWSE_FN, extractPlaylistVideos } from './utils.js';
import { CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

/**
 * Parse a playlist ID from a URL or bare ID string.
 */
function parsePlaylistId(input) {
    if (!input.startsWith('http'))
        return input;
    try {
        const url = new URL(input);
        return url.searchParams.get('list') || input;
    }
    catch {
        return input;
    }
}

cli({
    site: 'youtube',
    name: 'playlist',
    access: 'read',
    description: 'Get YouTube playlist info and video list',
    domain: 'www.youtube.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'id', required: true, positional: true, help: 'Playlist URL or playlist ID (PLxxxxxx)' },
        { name: 'limit', type: 'int', default: 50, help: 'Max videos to return (default 50, max 200)' },
    ],
    columns: ['rank', 'title', 'channel', 'duration', 'views', 'published', 'url'],
    func: async (page, kwargs) => {
        const playlistId = parsePlaylistId(String(kwargs.id));
        const limit = Math.min(kwargs.limit || 50, 200);
        await prepareYoutubeApiPage(page);
        const data = await page.evaluate(`
      (async () => {
        const cfg = window.ytcfg?.data_ || {};
        const apiKey = cfg.INNERTUBE_API_KEY;
        const context = cfg.INNERTUBE_CONTEXT;
        if (!apiKey || !context) return { error: 'YouTube config not found' };

        const browseId = 'VL' + ${JSON.stringify(playlistId)};
        const limit = ${limit};

        ${FETCH_BROWSE_FN}

        const data = await fetchBrowse(apiKey, { context, browseId });
        if (data.error) return data;

        const header = data.header?.pageHeaderRenderer;
        const title = header?.pageTitle || '';
        const metaRows = header?.content?.pageHeaderViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [];
        const stats = metaRows.flatMap(r => (r.metadataParts || []).map(p => p.text?.content || '').filter(Boolean));

        const sidebarItems = data.sidebar?.playlistSidebarRenderer?.items || [];
        const secondaryInfo = sidebarItems.find(i => i.playlistSidebarSecondaryInfoRenderer)?.playlistSidebarSecondaryInfoRenderer;
        const channelName = secondaryInfo?.videoOwner?.videoOwnerRenderer?.title?.runs?.[0]?.text || '';

        const tabs = data.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
        let listContents = tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer?.contents || [];

        const extractVideos = ${extractPlaylistVideos.toString()};

        let videos = extractVideos(listContents);

        let contItem = listContents[listContents.length - 1];
        while (videos.length < limit && contItem?.continuationItemRenderer) {
          const token = contItem.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
          if (!token) break;
          const contData = await fetchBrowse(apiKey, { context, continuation: token });
          if (contData.error) break;
          const newItems = contData.onResponseReceivedActions?.[0]?.appendContinuationItemsAction?.continuationItems || [];
          if (!newItems.length) break;
          videos = videos.concat(extractVideos(newItems));
          contItem = newItems[newItems.length - 1];
        }

        return { title, channelName, stats, videos: videos.slice(0, limit) };
      })()
    `);
        if (!data || typeof data !== 'object') {
            throw new CommandExecutionError('Failed to fetch playlist data');
        }
        if (data.error) {
            throw new CommandExecutionError(String(data.error));
        }
        if (!data.videos?.length) {
            throw new EmptyResultError('youtube playlist');
        }
        const statsStr = (data.stats || []).join(' | ');
        process.stderr.write(`${data.title}  [${data.channelName}]  ${statsStr}\n`);
        return data.videos;
    },
});
