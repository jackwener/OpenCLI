/**
 * YouTube history via the authenticated InnerTube FEhistory browse surface.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    ArgumentError,
    AuthRequiredError,
    CommandExecutionError,
    EmptyResultError,
    TimeoutError,
} from '@jackwener/opencli/errors';
import {
    prepareYoutubeApiPage,
    readYoutubeSapisid,
    SAPISID_HASH_FN,
} from './utils.js';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 200;
const MAX_PAGES = 20;
const REQUEST_TIMEOUT_SECONDS = 15;

function normalizeLimit(value) {
    const limit = Number(value ?? DEFAULT_LIMIT);
    if (!Number.isInteger(limit) || limit <= 0) {
        throw new ArgumentError('youtube history limit must be a positive integer');
    }
    if (limit > MAX_LIMIT) {
        throw new ArgumentError(`youtube history limit must be <= ${MAX_LIMIT}`);
    }
    return limit;
}

cli({
    site: 'youtube',
    name: 'history',
    access: 'read',
    description: 'Get YouTube watch history',
    domain: 'www.youtube.com',
    strategy: Strategy.COOKIE,
    args: [
        { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: 'Max videos to return (default 30, max 200)' },
    ],
    columns: ['rank', 'title', 'channel', 'views', 'duration', 'url'],
    func: async (page, kwargs) => {
        const limit = normalizeLimit(kwargs.limit);
        await prepareYoutubeApiPage(page);

        const sapisid = await readYoutubeSapisid(page);
        if (!sapisid) {
            throw new AuthRequiredError('www.youtube.com', 'Not logged in (SAPISID cookie missing)');
        }

        const result = await page.evaluate(`
      (async () => {
        ${SAPISID_HASH_FN}

        const limit = ${limit};
        const maxPages = ${MAX_PAGES};
        const requestTimeoutMs = ${REQUEST_TIMEOUT_SECONDS * 1000};
        const cfg = window.ytcfg?.data_ || {};
        const apiKey = cfg.INNERTUBE_API_KEY;
        const context = cfg.INNERTUBE_CONTEXT;
        if (!apiKey || !context) {
          return { error: 'config', message: 'YouTube InnerTube config not found' };
        }

        const authHash = await getSapisidHash(${JSON.stringify(sapisid)}, 'https://www.youtube.com');
        if (!authHash) return { error: 'auth', message: 'Not logged in (SAPISID cookie missing)' };

        function readText(value) {
          if (!value) return '';
          if (typeof value.simpleText === 'string') return value.simpleText;
          if (Array.isArray(value.runs)) return value.runs.map(run => run?.text || '').join('');
          return '';
        }

        function absoluteWatchUrl(path, videoId) {
          const value = path || (videoId ? '/watch?v=' + videoId : '');
          if (!value) return '';
          return value.startsWith('http') ? value : 'https://www.youtube.com' + value;
        }

        function fromLockup(lockup) {
          const metadata = lockup?.metadata?.lockupMetadataViewModel;
          const parts = (metadata?.metadata?.contentMetadataViewModel?.metadataRows || [])
            .flatMap(row => (row.metadataParts || []).map(part => part.text?.content || '').filter(Boolean));
          let duration = '';
          for (const overlay of (lockup?.contentImage?.thumbnailViewModel?.overlays || [])) {
            for (const badge of (overlay.thumbnailBottomOverlayViewModel?.badges || [])) {
              if (badge.thumbnailBadgeViewModel?.text) duration = badge.thumbnailBadgeViewModel.text;
            }
          }
          const commandUrl = lockup?.rendererContext?.commandContext?.onTap
            ?.innertubeCommand?.commandMetadata?.webCommandMetadata?.url || '';
          return [lockup?.contentId || '', {
            title: metadata?.title?.content || '',
            channel: parts[0] || '',
            views: parts.find(part => /views|观看/i.test(part)) || parts[1] || '',
            duration,
            url: absoluteWatchUrl(commandUrl, lockup?.contentId),
          }];
        }

        function fromVideoRenderer(video) {
          const commandUrl = video?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url || '';
          return [video?.videoId || '', {
            title: readText(video?.title),
            channel: readText(video?.ownerText) || readText(video?.shortBylineText),
            views: readText(video?.viewCountText) || readText(video?.shortViewCountText),
            duration: readText(video?.lengthText),
            url: absoluteWatchUrl(commandUrl, video?.videoId),
          }];
        }

        function extractPage(payload) {
          const entries = [];
          const pageIds = new Set();
          const messages = [];
          const cursors = [];
          let malformed = 0;

          function push(entry) {
            const [historyId, row] = entry || [];
            if (!historyId) return;
            if (!row.title || !row.url) {
              malformed += 1;
              return;
            }
            if (pageIds.has(historyId)) return;
            pageIds.add(historyId);
            entries.push([historyId, row]);
          }

          function visit(value) {
            if (!value || typeof value !== 'object') return;
            if (value.lockupViewModel?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
              push(fromLockup(value.lockupViewModel));
            }
            const renderer = value.videoRenderer || value.gridVideoRenderer || value.compactVideoRenderer;
            if (renderer?.videoId) push(fromVideoRenderer(renderer));

            const cursor = value.continuationItemRenderer
              ?.continuationEndpoint?.continuationCommand?.token;
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

        async function fetchPage(body) {
          let response;
          try {
            response = await fetch('/youtubei/v1/browse?key=' + encodeURIComponent(apiKey) + '&prettyPrint=false', {
              method: 'POST',
              credentials: 'include',
              signal: AbortSignal.timeout(requestTimeoutMs),
              headers: {
                'Content-Type': 'application/json',
                'Authorization': authHash,
                'X-Origin': 'https://www.youtube.com',
              },
              body: JSON.stringify({ context, ...body }),
            });
          } catch (error) {
            if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
              return { error: 'timeout' };
            }
            return { error: 'transport', message: String(error?.message || error) };
          }

          if (response.status === 401 || response.status === 403) {
            return { error: 'auth', message: 'YouTube history HTTP ' + response.status };
          }
          if (!response.ok) {
            return { error: 'http', message: 'YouTube history HTTP ' + response.status };
          }

          let payload;
          try {
            payload = await response.json();
          } catch (error) {
            return { error: 'json', message: String(error?.message || error) };
          }

          const upstreamStatus = payload?.error?.status || '';
          const upstreamCode = Number(payload?.error?.code || 0);
          if (upstreamCode === 401 || upstreamCode === 403 || upstreamStatus === 'UNAUTHENTICATED') {
            return { error: 'auth', message: upstreamStatus || 'YouTube history authentication failed' };
          }
          if (payload?.error) {
            return { error: 'api', message: upstreamStatus || payload.error.message || 'YouTube history API error' };
          }
          if (payload?.responseContext?.mainAppWebResponseContext?.loggedOut === true) {
            return { error: 'auth', message: 'YouTube history response is logged out' };
          }
          return { payload };
        }

        const rows = [];
        const seenIds = new Set();
        const seenCursors = new Set();
        let requestBody = { browseId: 'FEhistory' };
        let nextCursor = null;

        for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
          const fetched = await fetchPage(requestBody);
          if (fetched.error) return fetched;

          const pageData = extractPage(fetched.payload);
          if (pageData.malformed > 0) {
            return { error: 'malformed', message: 'YouTube history returned malformed video rows' };
          }
          for (const [historyId, row] of pageData.entries) {
            if (seenIds.has(historyId)) continue;
            seenIds.add(historyId);
            rows.push({
              rank: rows.length + 1,
              title: row.title,
              channel: row.channel,
              views: row.views,
              duration: row.duration,
              url: row.url,
            });
            if (rows.length >= limit) return rows;
          }

          nextCursor = pageData.nextCursor;
          if (!nextCursor) {
            if (rows.length > 0) return rows;
            return { error: 'empty', message: pageData.message || 'No watch history items found' };
          }
          if (seenCursors.has(nextCursor)) {
            return { error: 'repeated-cursor', message: 'YouTube history repeated a continuation cursor' };
          }
          seenCursors.add(nextCursor);
          requestBody = { continuation: nextCursor };
        }

        return {
          error: 'page-cap',
          message: 'YouTube history pagination stopped before satisfying the requested limit',
        };
      })()
    `);

        if (Array.isArray(result)) return result;
        if (result?.error === 'auth') {
            throw new AuthRequiredError('www.youtube.com', result.message || 'Not logged in to YouTube');
        }
        if (result?.error === 'timeout') {
            throw new TimeoutError('YouTube history request', REQUEST_TIMEOUT_SECONDS);
        }
        if (result?.error === 'empty') {
            throw new EmptyResultError('youtube history', result.message || 'No watch history items found');
        }
        throw new CommandExecutionError(result?.message || 'Failed to fetch YouTube history');
    },
});
