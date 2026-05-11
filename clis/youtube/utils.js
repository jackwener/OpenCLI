/**
 * Extract a YouTube video ID from a URL or bare video ID string.
 * Supports: watch?v=, youtu.be/, /shorts/, /embed/, /live/, /v/
 */
export function parseVideoId(input) {
    if (!input.startsWith('http'))
        return input;
    try {
        const parsed = new URL(input);
        if (parsed.searchParams.has('v')) {
            return parsed.searchParams.get('v');
        }
        if (parsed.hostname === 'youtu.be') {
            return parsed.pathname.slice(1).split('/')[0];
        }
        // Handle /shorts/xxx, /embed/xxx, /live/xxx, /v/xxx
        const pathMatch = parsed.pathname.match(/^\/(shorts|embed|live|v)\/([^/?]+)/);
        if (pathMatch)
            return pathMatch[2];
    }
    catch {
        // Not a valid URL — treat entire input as video ID
    }
    return input;
}
/**
 * Extract a JSON object assigned to a known bootstrap variable inside YouTube HTML.
 */
export function extractJsonAssignmentFromHtml(html, keys) {
    const candidates = Array.isArray(keys) ? keys : [keys];
    for (const key of candidates) {
        const markers = [
            `var ${key} = `,
            `window["${key}"] = `,
            `window.${key} = `,
            `${key} = `,
        ];
        for (const marker of markers) {
            const markerIndex = html.indexOf(marker);
            if (markerIndex === -1)
                continue;
            const jsonStart = html.indexOf('{', markerIndex + marker.length);
            if (jsonStart === -1)
                continue;
            let depth = 0;
            let inString = false;
            let escaping = false;
            for (let i = jsonStart; i < html.length; i += 1) {
                const ch = html[i];
                if (inString) {
                    if (escaping) {
                        escaping = false;
                    }
                    else if (ch === '\\') {
                        escaping = true;
                    }
                    else if (ch === '"') {
                        inString = false;
                    }
                    continue;
                }
                if (ch === '"') {
                    inString = true;
                    continue;
                }
                if (ch === '{') {
                    depth += 1;
                    continue;
                }
                if (ch === '}') {
                    depth -= 1;
                    if (depth === 0) {
                        try {
                            return JSON.parse(html.slice(jsonStart, i + 1));
                        }
                        catch {
                            break;
                        }
                    }
                }
            }
        }
    }
    return null;
}
/**
 * Prepare a quiet YouTube API-capable page without opening the watch UI.
 */
export async function prepareYoutubeApiPage(page) {
    await page.goto('https://www.youtube.com', { waitUntil: 'none' });
    await page.wait(2);
}
/**
 * Inline InnerTube browse API helper for use inside page.evaluate() strings.
 * Inject via FETCH_BROWSE_FN, then call: fetchBrowse(apiKey, body)
 */
export const FETCH_BROWSE_FN = `
async function fetchBrowse(apiKey, body) {
  const resp = await fetch('/youtubei/v1/browse?key=' + apiKey + '&prettyPrint=false', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) return { error: 'InnerTube browse API returned HTTP ' + resp.status };
  return resp.json();
}
`;
/**
 * Extract video objects from playlistVideoRenderer items (playlists, watch-later).
 * Pure function — inject into page.evaluate() via: extractPlaylistVideos.toString()
 */
export function extractPlaylistVideos(items) {
    return items
        .filter(i => i.playlistVideoRenderer)
        .map(i => {
        const v = i.playlistVideoRenderer;
        const infoRuns = v.videoInfo?.runs || [];
        return {
            rank: parseInt(v.index?.simpleText || '0', 10),
            title: v.title?.runs?.[0]?.text || '',
            channel: v.shortBylineText?.runs?.[0]?.text || '',
            duration: v.lengthText?.simpleText || '',
            views: infoRuns[0]?.text || '',
            published: infoRuns[2]?.text || '',
            url: 'https://www.youtube.com/watch?v=' + v.videoId,
        };
    });
}
/**
 * Normalize a subscribed channel entry from YouTube's channelRenderer payload.
 * Different surfaces/locales may expose the handle in channelHandleText, canonicalBaseUrl,
 * or, in some variants, overload one of the count fields with an @handle string.
 */
export function extractSubscriptionChannel(channelRenderer) {
    const readText = (value) => {
        if (!value)
            return '';
        if (typeof value.simpleText === 'string')
            return value.simpleText.trim();
        if (Array.isArray(value.runs)) {
            return value.runs
                .map((run) => run?.text || '')
                .join('')
                .trim();
        }
        return '';
    };
    const ch = channelRenderer || {};
    const name = readText(ch.title);
    const baseUrl = ch.navigationEndpoint?.browseEndpoint?.canonicalBaseUrl || '';
    const channelId = ch.channelId || ch.navigationEndpoint?.browseEndpoint?.browseId || '';
    const subscriberCountText = readText(ch.subscriberCountText);
    const videoCountText = readText(ch.videoCountText);
    const handle = [
        readText(ch.channelHandleText),
        baseUrl.startsWith('/@') ? baseUrl.slice(1) : '',
        subscriberCountText.startsWith('@') ? subscriberCountText : '',
        videoCountText.startsWith('@') ? videoCountText : '',
    ].find(Boolean) || '';
    const subscribers = [
        !subscriberCountText.startsWith('@') ? subscriberCountText : '',
        !videoCountText.startsWith('@') ? videoCountText : '',
    ].find(Boolean) || '';
    const url = baseUrl
        ? 'https://www.youtube.com' + baseUrl
        : channelId ? 'https://www.youtube.com/channel/' + channelId : '';
    return { name, handle, subscribers, url };
}
/**
 * Inline @handle → channelId resolver for use inside page.evaluate() strings.
 * Inject via RESOLVE_CHANNEL_HANDLE_FN, then call: resolveChannelHandle(input, apiKey, context)
 */
export const RESOLVE_CHANNEL_HANDLE_FN = `
async function resolveChannelHandle(input, apiKey, context) {
  if (!input.startsWith('@')) return input;
  const resp = await fetch('/youtubei/v1/navigation/resolve_url?key=' + apiKey + '&prettyPrint=false', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ context, url: 'https://www.youtube.com/' + input }),
  });
  if (!resp.ok) return input;
  const data = await resp.json().catch(() => ({}));
  return data.endpoint?.browseEndpoint?.browseId || input;
}
`;
/**
 * Inline SAPISIDHASH helper for use inside page.evaluate() strings.
 * YouTube write APIs (like, subscribe) require:
 *   Authorization: SAPISIDHASH {time}_{SHA1(time + " " + SAPISID + " " + origin)}
 *
 * The SAPISID cookie value must be hoisted from the cookie store on the Node side
 * (via `readYoutubeSapisid(page)`) and passed in here — keeps `crypto.subtle.digest`
 * (browser Web Crypto) call site, but no `document.cookie` round-trip.
 */
export const SAPISID_HASH_FN = `
async function getSapisidHash(sapisid, origin) {
  if (!sapisid) return null;
  const time = Math.floor(Date.now() / 1000);
  const msgBuffer = new TextEncoder().encode(time + ' ' + sapisid + ' ' + origin);
  const hashBuffer = await crypto.subtle.digest('SHA-1', msgBuffer);
  const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  return 'SAPISIDHASH ' + time + '_' + hashHex;
}
`;

/**
 * Read the YouTube SAPISID cookie via CDP, preferring `__Secure-3PAPISID`
 * (current first-party cookie) and falling back to the legacy `SAPISID` name.
 * Returns the cookie value, or null if neither is present.
 */
export async function readYoutubeSapisid(page) {
  const cookies = await page.getCookies({ url: 'https://www.youtube.com' });
  return (
    cookies.find((c) => c.name === '__Secure-3PAPISID')?.value
    || cookies.find((c) => c.name === 'SAPISID')?.value
    || null
  );
}
