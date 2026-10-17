/**
 * Xiaohongshu lives — list currently-live rooms with playable stream URLs.
 *
 * The /livelist page server-renders `__INITIAL_STATE__.liveList.liveList`
 * with everything a viewer needs: room id/title/viewer count
 * (`live.tRoomInfo`), host identity (`live.tLiveHostInfo`), and — inside the
 * double-nested JSON string `live.roomExtraInfo.live_stream_info` — the FLV
 * master URL, which plays without cookies (verified: plain HTTP 200 from the
 * CDN). No room-page visit is needed for discovery or playback.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { unwrapEvaluateResult } from './shared.js';

const LIVELIST_URL = 'https://www.xiaohongshu.com/livelist?channel_id=&channel_type=explore_feed';

/**
 * Private copy of the shared navigateFresh pattern (PR #2461 adds it to
 * shared.js) so this command stays merge-order independent; switch to the
 * shared import once that lands. A warm persistent tab at the target URL
 * fast-paths a plain goto without loading anything, so force a real reload.
 */
async function navigateFresh(page, url) {
    const current = typeof page.getCurrentUrl === 'function'
        ? await page.getCurrentUrl().catch(() => null)
        : null;
    if (current === url) {
        try {
            await page.evaluate('location.reload()');
            return;
        }
        catch {
            // fall through to the plain goto below
        }
    }
    await page.goto(url);
}

const LIVES_READ_JS = `
  (() => {
    const store = window.__INITIAL_STATE__?.liveList;
    const raw = store?.liveList?._value ?? store?.liveList;
    if (!Array.isArray(raw)) return { error: 'no_live_store' };
    return {
      items: raw
        .filter((entry) => entry && entry.type === 'live' && entry.live)
        .map((entry) => ({
          roomIdRaw: String(entry.live.tRoomInfo?.roomIdStr ?? ''),
          title: String(entry.live.tRoomInfo?.name ?? ''),
          viewers: Number(entry.live.tRoomInfo?.displayCount ?? 0),
          linkRaw: String(entry.live.tRoomInfo?.link ?? ''),
          host: String(entry.live.tLiveHostInfo?.nickname ?? ''),
          roomExtraInfoRaw: typeof entry.live.roomExtraInfo === 'string' ? entry.live.roomExtraInfo : '',
        })),
    };
  })()
`;

/**
 * Resolve the playable stream URL for a live-list row. Primary source is the
 * default stream's master_url inside roomExtraInfo -> live_stream_info (both
 * JSON strings); fallback is the flvUrl param of the xhsdiscover:// deeplink.
 */
export function extractLiveStreamUrl(roomExtraInfo, link) {
    try {
        const outer = JSON.parse(roomExtraInfo);
        const inner = JSON.parse(outer.live_stream_info);
        const streams = Array.isArray(inner?.streams) ? inner.streams : [];
        const chosen = streams.find((s) => s?.default_stream === 1) ?? streams[0];
        if (chosen?.master_url) return String(chosen.master_url);
    }
    catch {
        // fall through to the deeplink fallback
    }
    const match = /[?&]flvUrl=([^&]+)/.exec(String(link ?? ''));
    if (match) {
        try {
            return decodeURIComponent(match[1]);
        }
        catch {
            return '';
        }
    }
    return '';
}

function parseLimit(raw) {
    const parsed = Number(raw ?? 20);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) {
        throw new ArgumentError(`--limit must be a positive integer, got ${JSON.stringify(raw)}`);
    }
    return parsed;
}

export const command = cli({
    site: 'xiaohongshu',
    name: 'lives',
    access: 'read',
    description: '小红书直播列表（含可直接播放的 FLV 流地址）',
    domain: 'www.xiaohongshu.com',
    strategy: Strategy.COOKIE,
    browser: true,
    navigateBefore: false,
    siteSession: 'persistent',
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Number of live rooms to return' },
    ],
    columns: ['rank', 'room_id', 'title', 'host', 'viewers', 'stream_url', 'url'],
    func: async (page, kwargs) => {
        const limit = parseLimit(kwargs.limit);
        // Live listings churn constantly; a warm tab must reload for real.
        await navigateFresh(page, LIVELIST_URL);
        await page.wait({ time: 2 });
        let data = unwrapEvaluateResult(await page.evaluate(LIVES_READ_JS));
        if (!data || typeof data !== 'object' || data.error || !Array.isArray(data.items) || data.items.length === 0) {
            // One hydration retry: the SSR store may land a beat after load.
            await page.wait({ time: 2 });
            data = unwrapEvaluateResult(await page.evaluate(LIVES_READ_JS));
        }
        if (!data || typeof data !== 'object') {
            throw new CommandExecutionError('xiaohongshu lives: unexpected evaluate response');
        }
        if (data.error) {
            throw new CommandExecutionError(`xiaohongshu lives: ${data.error}`, 'The live list SPA may still be hydrating; retry in a moment.');
        }
        if (!Array.isArray(data.items)) {
            throw new CommandExecutionError('xiaohongshu lives: unexpected items payload shape');
        }
        const rows = data.items
            .filter((item) => item && typeof item === 'object' && item.roomIdRaw)
            .slice(0, limit)
            .map((item, index) => ({
            rank: index + 1,
            room_id: item.roomIdRaw,
            title: item.title,
            host: item.host,
            viewers: item.viewers,
            stream_url: extractLiveStreamUrl(item.roomExtraInfoRaw, item.linkRaw),
            url: `https://www.xiaohongshu.com/livestream/${item.roomIdRaw}`,
        }));
        if (rows.length === 0) {
            throw new EmptyResultError('xiaohongshu lives', 'No live rooms in the hydrated live-list store.');
        }
        return rows;
    },
});
