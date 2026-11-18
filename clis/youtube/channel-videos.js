/**
 * YouTube channel-videos — a channel's uploads as a proper video table
 * (video_id / title / duration / views / published / url).
 *
 * `youtube channel` returns the same list folded into field/value rows, which
 * downstream tooling cannot parse. This command reads the Videos tab through
 * InnerTube browse and follows `continuationItemRenderer` tokens until
 * `--limit` is reached.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { extractSelectedRichGridContents, parseVideoItem } from './channel-helpers.js';
import { FETCH_BROWSE_FN, parseYoutubeCount, RESOLVE_CHANNEL_HANDLE_FN } from './utils.js';

const MAX_LIMIT = 200;
const MAX_PAGES = 10;

export function normalizeChannelInput(raw) {
    const text = String(raw ?? '').trim();
    if (!text) {
        throw new ArgumentError('youtube channel-videos requires a channel id (UCxxxx) or @handle', 'Example: opencli youtube channel-videos @veritasium --limit 10');
    }
    try {
        if (/^https?:\/\//i.test(text)) {
            const parsed = new URL(text);
            const match = parsed.pathname.match(/^\/(?:channel\/(UC[\w-]+)|(@[^/]+))/);
            if (match) return match[1] || decodeURIComponent(match[2]);
        }
    }
    catch {
        // fall through to plain-text handling
    }
    if (/^UC[\w-]{20,}$/.test(text) || text.startsWith('@')) return text;
    // Bare handle without @
    if (/^[\w.-]{3,30}$/.test(text)) return `@${text}`;
    throw new ArgumentError(`Unrecognised channel reference: ${JSON.stringify(raw)}`, 'Pass a UC… channel id, an @handle, or a youtube.com channel URL.');
}

/**
 * Pull video rows plus the next continuation token out of a browse payload.
 * Pure — injected into page.evaluate via toString().
 */
export function collectVideosFromBrowse(payload, parseItem, extractGrid) {
    const contents = extractGrid(payload);
    const fromContinuation = payload?.onResponseReceivedActions?.flatMap((a) => a?.appendContinuationItemsAction?.continuationItems || []) || [];
    const items = contents.length > 0 ? contents : fromContinuation;
    const videos = [];
    let continuation = null;
    for (const item of items) {
        const token = item?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
        if (token) {
            continuation = token;
            continue;
        }
        const parsed = parseItem(item);
        if (parsed) videos.push(parsed);
    }
    return { videos, continuation };
}

cli({
    site: 'youtube',
    name: 'channel-videos',
    access: 'read',
    description: 'List a YouTube channel\'s uploads (video_id / title / duration / views / published / url)',
    domain: 'www.youtube.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'id', required: true, positional: true, help: 'Channel ID (UCxxxx), @handle, or channel URL' },
        { name: 'limit', type: 'int', default: 10, help: `Max videos (1-${MAX_LIMIT})` },
    ],
    columns: ['rank', 'video_id', 'title', 'duration', 'views', 'views_count', 'published', 'url', 'channel_id'],
    func: async (page, kwargs) => {
        const channelRef = normalizeChannelInput(kwargs.id);
        const limit = Number(kwargs.limit ?? 10);
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
            throw new ArgumentError(`--limit must be an integer between 1 and ${MAX_LIMIT}`);
        }
        await page.goto('https://www.youtube.com');
        await page.wait(2);
        const data = await page.evaluate(`
      (async () => {
        ${FETCH_BROWSE_FN}
        ${RESOLVE_CHANNEL_HANDLE_FN}
        const extractSelectedRichGridContents = ${extractSelectedRichGridContents.toString()};
        const parseVideoItem = ${parseVideoItem.toString()};
        const collectVideosFromBrowse = ${collectVideosFromBrowse.toString()};
        const channelRef = ${JSON.stringify(channelRef)};
        const limit = ${limit};
        const maxPages = ${MAX_PAGES};
        const cfg = window.ytcfg?.data_ || {};
        const apiKey = cfg.INNERTUBE_API_KEY;
        const context = cfg.INNERTUBE_CONTEXT;
        if (!apiKey || !context) return { error: 'YouTube config not found' };

        const browseId = await resolveChannelHandle(channelRef, apiKey, context);
        if (!browseId.startsWith('UC')) return { error: 'Could not resolve channel ' + channelRef + ' to a channel id' };

        const home = await fetchBrowse(apiKey, { context, browseId });
        if (home.error) return home;
        const tabs = home.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
        const videosTab = tabs.find(t => {
          const tab = t.tabRenderer;
          const url = tab?.endpoint?.commandMetadata?.webCommandMetadata?.url || '';
          return tab?.tabIdentifier === 'VIDEOS' || url.endsWith('/videos') || tab?.title === 'Videos';
        });
        const params = videosTab?.tabRenderer?.endpoint?.browseEndpoint?.params;
        if (!params) return { error: 'Channel has no Videos tab (empty channel or layout changed)', channelId: browseId };

        let payload = await fetchBrowse(apiKey, { context, browseId, params });
        if (payload.error) return payload;
        const videos = [];
        let pages = 0;
        while (payload && pages < maxPages) {
          pages++;
          const step = collectVideosFromBrowse(payload, parseVideoItem, extractSelectedRichGridContents);
          for (const v of step.videos) {
            if (videos.length >= limit) break;
            if (!videos.some(x => x.video_id === v.video_id)) videos.push(v);
          }
          if (videos.length >= limit || !step.continuation) break;
          payload = await fetchBrowse(apiKey, { context, continuation: step.continuation });
          if (payload.error) break;
        }
        return { channelId: browseId, videos };
      })()
    `);
        if (!data || typeof data !== 'object') throw new CommandExecutionError('Failed to fetch channel videos');
        if (data.error) throw new CommandExecutionError(String(data.error));
        const videos = Array.isArray(data.videos) ? data.videos : [];
        if (videos.length === 0) {
            throw new EmptyResultError('youtube channel-videos', `No videos found for ${channelRef}.`);
        }
        return videos.slice(0, limit).map((v, i) => ({
            rank: i + 1,
            video_id: v.video_id,
            title: v.title,
            duration: v.duration,
            views: v.views,
            views_count: parseYoutubeCount(String(v.views || '').split('|')[0]),
            published: v.published,
            url: v.url,
            channel_id: data.channelId || null,
        }));
    },
});

export const __test__ = { normalizeChannelInput, collectVideosFromBrowse, MAX_LIMIT };
