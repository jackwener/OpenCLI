import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CliError, CommandExecutionError, EXIT_CODES } from '@jackwener/opencli/errors';
import { httpDownload } from '@jackwener/opencli/download';
const INSTAGRAM_GRAPHQL_DOC_ID = '8845758582119845';
const INSTAGRAM_GRAPHQL_APP_ID = '936619743392459';
const INSTAGRAM_HOST_SUFFIX = 'instagram.com';
const SUPPORTED_KINDS = new Set(['p', 'reel', 'tv']);
function displayPath(filePath) {
    const home = os.homedir();
    return filePath.startsWith(home) ? `~${filePath.slice(home.length)}` : filePath;
}
export function parseInstagramMediaTarget(input) {
    const raw = String(input || '').trim();
    if (!raw) {
        throw new ArgumentError('Instagram URL is required', 'Expected https://www.instagram.com/p/... or https://www.instagram.com/reel/...');
    }
    let url;
    try {
        url = new URL(raw);
    }
    catch {
        throw new ArgumentError(`Invalid Instagram URL: ${raw}`, 'Expected https://www.instagram.com/p/<shortcode>/ or /reel/<shortcode>/');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new ArgumentError(`Unsupported URL protocol: ${url.protocol}`);
    }
    const host = url.hostname.toLowerCase();
    if (host !== INSTAGRAM_HOST_SUFFIX && !host.endsWith(`.${INSTAGRAM_HOST_SUFFIX}`)) {
        throw new ArgumentError(`Unsupported host: ${host}`, 'Only instagram.com URLs are supported');
    }
    const segments = url.pathname.split('/').filter(Boolean);
    let kind;
    let shortcode;
    if (segments.length >= 2 && SUPPORTED_KINDS.has(segments[0])) {
        kind = segments[0];
        shortcode = segments[1];
    }
    else if (segments.length >= 3 && SUPPORTED_KINDS.has(segments[1])) {
        kind = segments[1];
        shortcode = segments[2];
    }
    if (!kind || !shortcode) {
        throw new ArgumentError(`Unsupported Instagram media URL: ${raw}`, 'Only /p/<shortcode>/, /reel/<shortcode>/, and /tv/<shortcode>/ links are supported');
    }
    return {
        kind: kind,
        shortcode,
        canonicalUrl: `https://www.instagram.com/${kind}/${shortcode}/`,
    };
}
export function buildInstagramDownloadItems(shortcode, items) {
    return items
        .filter((item) => item?.url)
        .map((item, index) => {
        const fallbackExt = item.type === 'video' ? '.mp4' : '.jpg';
        let ext = fallbackExt;
        try {
            const pathname = new URL(item.url).pathname;
            const candidateExt = path.extname(pathname).toLowerCase();
            if (candidateExt && candidateExt.length <= 8)
                ext = candidateExt;
        }
        catch {
            ext = fallbackExt;
        }
        return {
            type: item.type,
            url: item.url,
            filename: `${shortcode}_${String(index + 1).padStart(2, '0')}${ext}`,
        };
    });
}
export function buildInstagramFetchScript(shortcode) {
    return `
    (async () => {
      const shortcode = ${JSON.stringify(shortcode)};
      const docId = ${JSON.stringify(INSTAGRAM_GRAPHQL_DOC_ID)};
      const variables = {
        shortcode,
        fetch_tagged_user_count: null,
        hoisted_comment_id: null,
        hoisted_reply_id: null,
      };
      const url = 'https://www.instagram.com/graphql/query/?doc_id=' + docId + '&variables=' + encodeURIComponent(JSON.stringify(variables));
      const res = await fetch(url, {
        credentials: 'include',
        headers: {
          'Accept': 'application/json,text/plain,*/*',
          'X-IG-App-ID': ${JSON.stringify(INSTAGRAM_GRAPHQL_APP_ID)},
        },
      });
      const rawText = await res.text();

      let data = null;
      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        return {
          ok: false,
          errorCode: 'COMMAND_EXEC',
          error: 'Instagram returned non-JSON content while fetching media metadata',
        };
      }

      const message = typeof data?.message === 'string' ? data.message : '';
      const lowered = (message || '').toLowerCase();

      if (!res.ok) {
        if (res.status === 401 || res.status === 403 || data?.require_login) {
          return { ok: false, errorCode: 'AUTH_REQUIRED', error: message || ('HTTP ' + res.status) };
        }
        if (res.status === 429) {
          return { ok: false, errorCode: 'RATE_LIMITED', error: message || 'HTTP 429' };
        }
        if (res.status === 404 || res.status === 410) {
          return { ok: false, errorCode: 'PRIVATE_OR_UNAVAILABLE', error: message || ('HTTP ' + res.status) };
        }
        return { ok: false, errorCode: 'COMMAND_EXEC', error: message || ('HTTP ' + res.status) };
      }

      if (data?.require_login) {
        return { ok: false, errorCode: 'AUTH_REQUIRED', error: message || 'Instagram login required' };
      }
      if (lowered.includes('wait a few minutes') || lowered.includes('rate')) {
        return { ok: false, errorCode: 'RATE_LIMITED', error: message || 'Instagram rate limit triggered' };
      }

      const media = data?.data?.xdt_shortcode_media;
      if (!media) {
        return {
          ok: false,
          errorCode: 'PRIVATE_OR_UNAVAILABLE',
          error: message || 'Post may be private, unavailable, or inaccessible to the current browser session',
        };
      }

      const nodes = Array.isArray(media?.edge_sidecar_to_children?.edges) && media.edge_sidecar_to_children.edges.length > 0
        ? media.edge_sidecar_to_children.edges.map((edge) => edge?.node).filter(Boolean)
        : [media];

      const items = nodes
        .map((node) => ({
          type: node?.is_video ? 'video' : 'image',
          url: String(node?.is_video ? (node?.video_url || '') : (node?.display_url || '')),
        }))
        .filter((item) => item.url);

      return {
        ok: true,
        shortcode: media.shortcode || shortcode,
        owner: media?.owner?.username || '',
        items,
      };
    })()
  `;
}
function ensurePage(page) {
    if (!page)
        throw new CommandExecutionError('Browser session required');
    return page;
}
function normalizeFetchResult(result) {
    if (!result || typeof result !== 'object') {
        throw new CommandExecutionError('Failed to fetch Instagram media metadata');
    }
    return result;
}
function handleFetchFailure(result) {
    const message = result.error || 'Instagram media fetch failed';
    if (result.errorCode === 'AUTH_REQUIRED') {
        throw new AuthRequiredError('instagram.com', message);
    }
    if (result.errorCode === 'RATE_LIMITED') {
        throw new CliError('RATE_LIMITED', message, 'Wait a few minutes and retry, or switch to a browser session with a warmer Instagram login state.', EXIT_CODES.TEMPFAIL);
    }
    if (result.errorCode === 'PRIVATE_OR_UNAVAILABLE') {
        throw new CommandExecutionError(message, 'Open the post in a logged-in browser session and retry');
    }
    throw new CommandExecutionError(message);
}
async function downloadInstagramMedia(items, outputDir) {
    fs.mkdirSync(outputDir, { recursive: true });
    for (const item of items) {
        const destPath = path.join(outputDir, item.filename);
        const result = await httpDownload(item.url, destPath, {
            timeout: item.type === 'video' ? 120000 : 60000,
        });
        if (!result.success) {
            throw new CommandExecutionError(`Failed to download ${item.filename}: ${result.error || 'unknown error'}`);
        }
    }
}
cli({
    site: 'instagram',
    name: 'download',
    description: 'Download images and videos from Instagram posts and reels',
    domain: 'www.instagram.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        { name: 'url', positional: true, required: true, help: 'Instagram post / reel / tv URL' },
        { name: 'path', default: path.join(os.homedir(), 'Downloads', 'Instagram'), help: 'Download directory' },
    ],
    func: async (page, kwargs) => {
        const browserPage = ensurePage(page);
        const target = parseInstagramMediaTarget(String(kwargs.url ?? ''));
        const outputRoot = String(kwargs.path ?? path.join(os.homedir(), 'Downloads', 'Instagram'));
        await browserPage.goto(target.canonicalUrl);
        const fetchResult = normalizeFetchResult(await browserPage.evaluate(buildInstagramFetchScript(target.shortcode)));
        if (!fetchResult.ok)
            handleFetchFailure(fetchResult);
        const shortcode = fetchResult.shortcode || target.shortcode;
        const mediaItems = buildInstagramDownloadItems(shortcode, fetchResult.items || []);
        if (mediaItems.length === 0) {
            throw new CommandExecutionError('No downloadable media found');
        }
        const savedDir = path.join(outputRoot, shortcode);
        await downloadInstagramMedia(mediaItems, savedDir);
        console.log(`📁 saved: ${displayPath(savedDir)}`);
        return null;
    },
});
