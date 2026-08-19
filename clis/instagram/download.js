import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, AuthRequiredError, CliError, CommandExecutionError, EXIT_CODES } from '@jackwener/opencli/errors';
import { httpDownload } from '@jackwener/opencli/download';
const INSTAGRAM_APP_ID = '936619743392459';
const INSTAGRAM_HOST_SUFFIX = 'instagram.com';
const INSTAGRAM_SHORTCODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const MAX_INSTAGRAM_MEDIA_ID = 9223372036854775807n;
const SUPPORTED_KINDS = new Set(['p', 'reel', 'tv']);
function displayPath(filePath) {
    const home = os.homedir();
    return filePath.startsWith(home) ? `~${filePath.slice(home.length)}` : filePath;
}
function unwrapEvaluateResult(result) {
    if (result && typeof result === 'object' && !Array.isArray(result) && 'session' in result && 'data' in result) {
        return result.data;
    }
    return result;
}
export function resolveOutputDir(value) {
    const raw = String(value || '').trim();
    if (!raw) return path.join(os.homedir(), 'Downloads', 'Instagram');
    if (raw === '~') return os.homedir();
    if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
    return path.resolve(raw);
}
/** A shortcode is the media id written in Instagram's base64 alphabet. */
export function shortcodeToMediaId(shortcode) {
    const raw = String(shortcode || '');
    if (!raw) return '';
    let mediaId = 0n;
    for (const character of raw) {
        const digit = INSTAGRAM_SHORTCODE_ALPHABET.indexOf(character);
        if (digit < 0) return '';
        mediaId = mediaId * 64n + BigInt(digit);
        if (mediaId > MAX_INSTAGRAM_MEDIA_ID) return '';
    }
    if (mediaId <= 0n) return '';
    return mediaId.toString();
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
    if (!shortcodeToMediaId(shortcode)) {
        throw new ArgumentError(`Invalid Instagram shortcode: ${shortcode}`, 'Copy the link straight from the post, without escaping it');
    }
    return {
        kind: kind,
        shortcode,
        canonicalUrl: `https://www.instagram.com/${kind}/${shortcode}/`,
    };
}
export function buildInstagramDownloadItems(shortcode, items) {
    if (!Array.isArray(items)) {
        throw new CommandExecutionError('Instagram media metadata returned a malformed media list');
    }
    return items.map((item, index) => {
        if (!item || typeof item !== 'object' || !['image', 'video'].includes(item.type)) {
            throw new CommandExecutionError(`Instagram media metadata returned malformed media item #${index + 1}`);
        }
        let downloadUrl;
        try {
            downloadUrl = new URL(String(item.url || ''));
        }
        catch {
            throw new CommandExecutionError(`Instagram media metadata returned an invalid download URL for item #${index + 1}`);
        }
        if (!['http:', 'https:'].includes(downloadUrl.protocol)) {
            throw new CommandExecutionError(`Instagram media metadata returned an unsupported download URL for item #${index + 1}`);
        }
        const fallbackExt = item.type === 'video' ? '.mp4' : '.jpg';
        let ext = fallbackExt;
        const candidateExt = path.extname(downloadUrl.pathname).toLowerCase();
        if (candidateExt && candidateExt.length <= 8)
            ext = candidateExt;
        return {
            type: item.type,
            url: downloadUrl.toString(),
            filename: `${shortcode}_${String(index + 1).padStart(2, '0')}${ext}`,
        };
    });
}
export function buildInstagramFetchScript(shortcode) {
    // The persisted GraphQL query this used to send now answers HTTP 200 with
    // an execution error and no media, which read as a private post (#2247).
    // The media info endpoint carries the same fields and needs no rotating id.
    return `
    (async () => {
      const shortcode = ${JSON.stringify(shortcode)};
      const mediaId = ${JSON.stringify(shortcodeToMediaId(shortcode))};
      const url = 'https://www.instagram.com/api/v1/media/' + mediaId + '/info/';
      let res = null;
      try {
        res = await fetch(url, {
          credentials: 'include',
          headers: {
            'Accept': 'application/json,text/plain,*/*',
            'X-IG-App-ID': ${JSON.stringify(INSTAGRAM_APP_ID)},
          },
        });
      } catch (err) {
        return {
          ok: false,
          errorCode: 'COMMAND_EXEC',
          error: 'Instagram media info request failed: ' + (err && err.message ? err.message : String(err || 'fetch failed')),
        };
      }
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
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return {
          ok: false,
          errorCode: 'COMMAND_EXEC',
          error: 'Instagram returned malformed media metadata',
        };
      }

      const message = typeof data?.message === 'string' ? data.message : '';
      const lowered = (message || '').toLowerCase();
      const classifyInBandFailure = () => {
        if (data?.require_login || lowered.includes('login') || lowered.includes('auth')) {
          return { ok: false, errorCode: 'AUTH_REQUIRED', error: message || 'Instagram login required' };
        }
        if (lowered.includes('wait a few minutes') || lowered.includes('rate')) {
          return { ok: false, errorCode: 'RATE_LIMITED', error: message || 'Instagram rate limit triggered' };
        }
        if (lowered.includes('not found') || lowered.includes('unavailable') || lowered.includes('private')) {
          return { ok: false, errorCode: 'PRIVATE_OR_UNAVAILABLE', error: message || 'Post may be private or unavailable' };
        }
        return { ok: false, errorCode: 'COMMAND_EXEC', error: message || 'Instagram returned a failed media metadata status' };
      };

      if (!res.ok) {
        if (res.status === 401 || res.status === 403 || data?.require_login) {
          return { ok: false, errorCode: 'AUTH_REQUIRED', error: message || ('HTTP ' + res.status) };
        }
        if (res.status === 429) {
          return { ok: false, errorCode: 'RATE_LIMITED', error: message || 'HTTP 429' };
        }
        if (res.status === 404 || res.status === 410 || data?.status === 'fail') {
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
      if (typeof data?.status === 'string' && data.status !== 'ok') {
        return classifyInBandFailure();
      }

      if (!Array.isArray(data?.items)) {
        return {
          ok: false,
          errorCode: 'COMMAND_EXEC',
          error: 'Instagram media metadata returned malformed items',
        };
      }
      if (data.items.length === 0) {
        return {
          ok: false,
          errorCode: 'PRIVATE_OR_UNAVAILABLE',
          error: message || 'Post may be private, unavailable, or inaccessible to the current browser session',
        };
      }
      const media = data.items[0];
      if (!media || typeof media !== 'object' || Array.isArray(media)) {
        return {
          ok: false,
          errorCode: 'COMMAND_EXEC',
          error: 'Instagram media metadata returned malformed media item',
        };
      }
      if (media.code !== shortcode) {
        return {
          ok: false,
          errorCode: 'COMMAND_EXEC',
          error: 'Instagram media info returned metadata for a different shortcode',
        };
      }

      const widest = (candidates, label) => {
        if (!Array.isArray(candidates) || candidates.length === 0) {
          return { ok: false, error: 'Instagram media metadata is missing ' + label };
        }
        let best = null;
        for (const candidate of candidates) {
          if (!candidate || typeof candidate !== 'object' || typeof candidate.url !== 'string' || !candidate.url) continue;
          const width = Number(candidate.width) || 0;
          if (!best || width > best.width) best = { width, url: candidate.url };
        }
        if (!best) {
          return { ok: false, error: 'Instagram media metadata has no usable ' + label };
        }
        return { ok: true, url: best.url };
      };
      const pickNode = (node, index) => {
        if (!node || typeof node !== 'object' || Array.isArray(node)) {
          return { ok: false, error: 'Instagram media metadata returned malformed carousel item #' + (index + 1) };
        }
        if (node.media_type === 1) {
          const picked = widest(node?.image_versions2?.candidates, 'image candidates for item #' + (index + 1));
          return picked.ok ? { ok: true, item: { type: 'image', url: picked.url } } : picked;
        }
        if (node.media_type === 2) {
          const picked = widest(node?.video_versions, 'video renditions for item #' + (index + 1));
          return picked.ok ? { ok: true, item: { type: 'video', url: picked.url } } : picked;
        }
        return { ok: false, error: 'Instagram media metadata returned unsupported media_type for item #' + (index + 1) };
      };

      let nodes = null;
      if (media.media_type === 8) {
        if (!Array.isArray(media.carousel_media) || media.carousel_media.length === 0) {
          return {
            ok: false,
            errorCode: 'COMMAND_EXEC',
            error: 'Instagram carousel metadata returned no media items',
          };
        }
        nodes = media.carousel_media;
      } else if (media.media_type === 1 || media.media_type === 2) {
        nodes = [media];
      } else {
        return {
          ok: false,
          errorCode: 'COMMAND_EXEC',
          error: 'Instagram media metadata returned unsupported media_type',
        };
      }

      const items = [];
      for (let index = 0; index < nodes.length; index += 1) {
        const picked = pickNode(nodes[index], index);
        if (!picked.ok) {
          return { ok: false, errorCode: 'COMMAND_EXEC', error: picked.error };
        }
        items.push(picked.item);
      }

      return {
        ok: true,
        shortcode: media.code,
        owner: media?.user?.username || '',
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
    const unwrapped = unwrapEvaluateResult(result);
    if (!unwrapped || typeof unwrapped !== 'object' || Array.isArray(unwrapped)) {
        throw new CommandExecutionError('Failed to fetch Instagram media metadata');
    }
    if (typeof unwrapped.ok !== 'boolean') {
        throw new CommandExecutionError('Instagram media metadata returned malformed result');
    }
    return unwrapped;
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
        if (!Number.isFinite(result.size) || result.size <= 0) {
            throw new CommandExecutionError(`Failed to verify downloaded bytes for ${item.filename}`);
        }
    }
}
cli({
    site: 'instagram',
    name: 'download',
    access: 'read',
    description: 'Download images and videos from Instagram posts and reels',
    domain: 'www.instagram.com',
    strategy: Strategy.COOKIE,
    navigateBefore: false,
    args: [
        { name: 'url', positional: true, required: true, help: 'Instagram post / reel / tv URL' },
        { name: 'path', default: '~/Downloads/Instagram', help: 'Download directory' },
    ],
    func: async (page, kwargs) => {
        const browserPage = ensurePage(page);
        const target = parseInstagramMediaTarget(String(kwargs.url ?? ''));
        const outputRoot = resolveOutputDir(kwargs.path);
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
