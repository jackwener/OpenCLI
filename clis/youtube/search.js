/**
 * YouTube search via initial page state and authenticated InnerTube continuations.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    AuthRequiredError,
    CommandExecutionError,
    EmptyResultError,
    TimeoutError,
} from '@jackwener/opencli/errors';
import { readYoutubeSapisid, SAPISID_HASH_FN } from './utils.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const MAX_PAGES = 10;
const REQUEST_TIMEOUT_SECONDS = 15;

const TYPE_FILTERS = {
    shorts: 'EgIQCQ%3D%3D',
    video: 'EgIQAQ%3D%3D',
    channel: 'EgIQAg%3D%3D',
    playlist: 'EgIQAw%3D%3D',
};
const UPLOAD_FILTERS = {
    hour: 'EgIIAQ%3D%3D',
    today: 'EgIIAg%3D%3D',
    week: 'EgIIAw%3D%3D',
    month: 'EgIIBA%3D%3D',
    year: 'EgIIBQ%3D%3D',
};
const SORT_FILTERS = {
    relevance: '',
    date: 'CAI%3D',
    views: 'CAM%3D',
    rating: 'CAE%3D',
};

function normalizeChoice(value, choices, label) {
    const normalized = String(value || '').trim();
    if (normalized && !Object.hasOwn(choices, normalized)) {
        throw new ArgumentError(`youtube search ${label} must be one of: ${Object.keys(choices).join(', ')}`);
    }
    return normalized;
}

function normalizeLimit(value) {
    const limit = Number(value ?? DEFAULT_LIMIT);
    if (!Number.isInteger(limit) || limit <= 0) {
        throw new ArgumentError('youtube search limit must be a positive integer');
    }
    if (limit > MAX_LIMIT) {
        throw new ArgumentError(`youtube search limit must be <= ${MAX_LIMIT}`);
    }
    return limit;
}

cli({
    site: 'youtube',
    name: 'search',
    access: 'read',
    description: 'Search YouTube videos, Shorts, channels, and playlists',
    domain: 'www.youtube.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'query', required: true, positional: true, help: 'Search query' },
        { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: 'Max results (max 50)' },
        { name: 'type', default: '', help: 'Filter type: shorts, video, channel, playlist' },
        { name: 'upload', default: '', help: 'Upload date: hour, today, week, month, year' },
        { name: 'sort', default: '', help: 'Sort by: relevance, date, views, rating' },
    ],
    columns: ['rank', 'title', 'channel', 'channel_avatar', 'video_id', 'views', 'duration', 'published', 'url'],
    func: async (page, kwargs) => {
        const query = String(kwargs.query || '').trim();
        if (!query) throw new ArgumentError('youtube search query cannot be empty');
        const limit = normalizeLimit(kwargs.limit);
        const resultType = normalizeChoice(kwargs.type, TYPE_FILTERS, 'type');
        const upload = normalizeChoice(kwargs.upload, UPLOAD_FILTERS, 'upload');
        const sort = normalizeChoice(kwargs.sort, SORT_FILTERS, 'sort');

        // YouTube accepts one sp parameter. Preserve the existing priority:
        // type > upload > sort.
        const sp = TYPE_FILTERS[resultType] || UPLOAD_FILTERS[upload] || SORT_FILTERS[sort] || '';
        let url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
        if (sp) url += `&sp=${sp}`;
        await page.goto(url);
        await page.wait(3);

        const sapisid = await readYoutubeSapisid(page);
        const result = await page.evaluate(`
      (async () => {
        ${SAPISID_HASH_FN}

        const limit = ${limit};
        const resultType = ${JSON.stringify(resultType)};
        const maxPages = ${MAX_PAGES};
        const requestTimeoutMs = ${REQUEST_TIMEOUT_SECONDS * 1000};
        const cfg = window.ytcfg?.data_ || {};
        const apiKey = cfg.INNERTUBE_API_KEY;
        const context = cfg.INNERTUBE_CONTEXT;
        const initialData = window.ytInitialData;
        if (!apiKey || !context || !initialData) {
          return { error: 'config', message: 'YouTube search bootstrap data not found' };
        }
        const signedIn = cfg.LOGGED_IN === true || window.ytcfg?.get?.('LOGGED_IN') === true;

        function readText(value) {
          if (!value) return '';
          if (typeof value.content === 'string') return value.content;
          if (typeof value.simpleText === 'string') return value.simpleText;
          if (Array.isArray(value.runs)) return value.runs.map(run => run?.text || '').join('');
          return '';
        }

        function absoluteUrl(path) {
          if (!path) return '';
          return path.startsWith('http') ? path : 'https://www.youtube.com' + path;
        }

        // Channel avatar: thumbnails/sources are smallest-first, so take the last one.
        function readAvatar(node) {
          const thumbnails = node?.channelThumbnailSupportedRenderers
            ?.channelThumbnailWithLinkRenderer?.thumbnail?.thumbnails
            || node?.thumbnail?.thumbnails
            || [];
          return thumbnails[thumbnails.length - 1]?.url || '';
        }

        function fromVideo(video) {
          const path = video?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url
            || (video?.videoId ? '/watch?v=' + video.videoId : '');
          return [video?.videoId || '', {
            title: readText(video?.title),
            channel: readText(video?.ownerText) || readText(video?.shortBylineText),
            channel_avatar: readAvatar(video),
            video_id: video?.videoId || '',
            views: readText(video?.viewCountText) || readText(video?.shortViewCountText),
            duration: readText(video?.lengthText) || 'LIVE',
            published: readText(video?.publishedTimeText),
            url: absoluteUrl(path),
          }];
        }

        function fromLegacyShort(reel) {
          return [reel?.videoId || '', {
            title: readText(reel?.headline),
            channel: readText(reel?.navigationEndpoint?.reelWatchEndpoint?.overlay?.reelPlayerOverlayRenderer
              ?.reelPlayerHeaderSupportedRenderers?.reelPlayerHeaderRenderer?.channelTitleText),
            channel_avatar: readAvatar(reel),
            video_id: reel?.videoId || '',
            views: readText(reel?.viewCountText),
            duration: 'SHORT',
            published: readText(reel?.publishedTimeText),
            url: reel?.videoId ? 'https://www.youtube.com/shorts/' + reel.videoId : '',
          }];
        }

        function fromShortLockup(short) {
          const command = short?.onTap?.innertubeCommand;
          const videoId = command?.reelWatchEndpoint?.videoId
            || short?.inlinePlayerData?.onVisible?.innertubeCommand?.watchEndpoint?.videoId
            || '';
          const path = command?.commandMetadata?.webCommandMetadata?.url
            || (videoId ? '/shorts/' + videoId : '');
          return [videoId, {
            title: readText(short?.overlayMetadata?.primaryText),
            channel: '',
            channel_avatar: '',
            video_id: videoId,
            views: readText(short?.overlayMetadata?.secondaryText),
            duration: 'SHORT',
            published: '',
            url: absoluteUrl(path),
          }];
        }

        function fromChannel(channel) {
          const path = channel?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url
            || channel?.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl
            || (channel?.channelId ? '/channel/' + channel.channelId : '');
          const handleCandidate = readText(channel?.subscriberCountText);
          return [channel?.channelId || channel?.navigationEndpoint?.browseEndpoint?.browseId || '', {
            title: readText(channel?.title),
            channel: handleCandidate.startsWith('@') ? handleCandidate : '',
            channel_avatar: readAvatar(channel),
            video_id: '',
            views: readText(channel?.videoCountText) || (!handleCandidate.startsWith('@') ? handleCandidate : ''),
            duration: 'CHANNEL',
            published: '',
            url: absoluteUrl(path),
          }];
        }

        function fromPlaylist(playlist) {
          const playlistId = playlist?.playlistId || playlist?.navigationEndpoint?.watchEndpoint?.playlistId || '';
          return [playlistId, {
            title: readText(playlist?.title),
            channel: readText(playlist?.shortBylineText) || readText(playlist?.longBylineText),
            channel_avatar: '',
            video_id: '',
            views: readText(playlist?.videoCountText),
            duration: 'PLAYLIST',
            published: '',
            url: playlistId ? 'https://www.youtube.com/playlist?list=' + playlistId : '',
          }];
        }

        function fromPlaylistLockup(lockup) {
          const metadata = lockup?.metadata?.lockupMetadataViewModel;
          const parts = (metadata?.metadata?.contentMetadataViewModel?.metadataRows || [])
            .flatMap(row => (row.metadataParts || []).map(part => readText(part?.text)).filter(Boolean));
          const playlistId = lockup?.contentId || '';
          return [playlistId, {
            title: readText(metadata?.title),
            channel: parts[0] || '',
            channel_avatar: metadata?.image?.decoratedAvatarViewModel?.avatar
              ?.avatarViewModel?.image?.sources?.slice(-1)?.[0]?.url || '',
            video_id: '',
            views: '',
            duration: 'PLAYLIST',
            published: '',
            url: playlistId ? 'https://www.youtube.com/playlist?list=' + playlistId : '',
          }];
        }

        function extractPage(payload) {
          const entries = [];
          const pageIds = new Set();
          const cursors = [];
          const messages = [];
          let malformed = 0;

          function push(entry) {
            const [searchId, row] = entry || [];
            if (!searchId) return;
            if (!row?.title || !row?.url) {
              malformed += 1;
              return;
            }
            if (pageIds.has(searchId)) return;
            pageIds.add(searchId);
            entries.push([searchId, row]);
          }

          function visit(value) {
            if (!value || typeof value !== 'object') return;
            if (!resultType || resultType === 'video') {
              if (value.videoRenderer?.videoId) push(fromVideo(value.videoRenderer));
            } else if (resultType === 'shorts') {
              if (value.reelItemRenderer?.videoId) push(fromLegacyShort(value.reelItemRenderer));
              if (value.shortsLockupViewModel) push(fromShortLockup(value.shortsLockupViewModel));
            } else if (resultType === 'channel') {
              if (value.channelRenderer) push(fromChannel(value.channelRenderer));
            } else if (resultType === 'playlist') {
              if (value.playlistRenderer) push(fromPlaylist(value.playlistRenderer));
              if (value.lockupViewModel?.contentType === 'LOCKUP_CONTENT_TYPE_PLAYLIST') {
                push(fromPlaylistLockup(value.lockupViewModel));
              }
            }

            const cursor = value.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
            if (cursor) cursors.push(cursor);
            const message = readText(value.messageRenderer?.text);
            if (message) messages.push(message);
            for (const child of Object.values(value)) visit(child);
          }

          visit(payload);
          return {
            entries,
            nextCursor: cursors[cursors.length - 1] || null,
            message: messages[0] || '',
            malformed,
          };
        }

        async function fetchContinuation(cursor) {
          let authHash = null;
          if (${JSON.stringify(sapisid)}) {
            authHash = await getSapisidHash(${JSON.stringify(sapisid)}, 'https://www.youtube.com');
          }
          if (signedIn && !authHash) {
            return { error: 'auth', message: 'Signed-in YouTube search session has no SAPISID cookie' };
          }
          const headers = { 'Content-Type': 'application/json' };
          if (authHash) {
            headers.Authorization = authHash;
            headers['X-Origin'] = 'https://www.youtube.com';
          }

          let response;
          try {
            response = await fetch('/youtubei/v1/search?key=' + encodeURIComponent(apiKey) + '&prettyPrint=false', {
              method: 'POST',
              credentials: 'include',
              signal: AbortSignal.timeout(requestTimeoutMs),
              headers,
              body: JSON.stringify({ context, continuation: cursor }),
            });
          } catch (error) {
            if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return { error: 'timeout' };
            return { error: 'transport', message: String(error?.message || error) };
          }

          if (response.status === 401 || (response.status === 403 && signedIn)) {
            return { error: 'auth', message: 'YouTube search HTTP ' + response.status };
          }
          if (!response.ok) return { error: 'http', message: 'YouTube search HTTP ' + response.status };

          let payload;
          try {
            payload = await response.json();
          } catch (error) {
            return { error: 'json', message: String(error?.message || error) };
          }
          const upstreamStatus = payload?.error?.status || '';
          const upstreamCode = Number(payload?.error?.code || 0);
          if (upstreamCode === 401 || upstreamStatus === 'UNAUTHENTICATED') {
            return { error: 'auth', message: upstreamStatus || 'YouTube search authentication failed' };
          }
          if (payload?.error) {
            return { error: 'api', message: upstreamStatus || payload.error.message || 'YouTube search API error' };
          }
          if (signedIn && payload?.responseContext?.mainAppWebResponseContext?.loggedOut === true) {
            return { error: 'auth', message: 'YouTube search continuation response is logged out' };
          }
          return { payload };
        }

        const rows = [];
        const seenIds = new Set();
        const seenCursors = new Set();
        let pageData = extractPage(initialData);

        for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
          if (pageData.malformed > 0) {
            return { error: 'malformed', message: 'YouTube search returned malformed result rows' };
          }
          for (const [searchId, row] of pageData.entries) {
            if (seenIds.has(searchId)) continue;
            seenIds.add(searchId);
            rows.push({ rank: rows.length + 1, ...row });
            if (rows.length >= limit) return rows;
          }

          const cursor = pageData.nextCursor;
          if (!cursor) {
            if (rows.length > 0) return rows;
            return { error: 'empty', message: pageData.message || 'No YouTube search results found' };
          }
          if (seenCursors.has(cursor)) {
            return { error: 'repeated-cursor', message: 'YouTube search repeated a continuation cursor' };
          }
          seenCursors.add(cursor);
          const fetched = await fetchContinuation(cursor);
          if (fetched.error) return fetched;
          pageData = extractPage(fetched.payload);
        }

        return { error: 'page-cap', message: 'YouTube search pagination stopped before satisfying the requested limit' };
      })()
    `);

        if (Array.isArray(result)) return result;
        if (result?.error === 'auth') {
            throw new AuthRequiredError('www.youtube.com', result.message || 'Not logged in to YouTube');
        }
        if (result?.error === 'timeout') {
            throw new TimeoutError('YouTube search request', REQUEST_TIMEOUT_SECONDS);
        }
        if (result?.error === 'empty') {
            throw new EmptyResultError('youtube search', result.message || 'No YouTube search results found');
        }
        throw new CommandExecutionError(result?.message || 'Failed to search YouTube');
    },
});
