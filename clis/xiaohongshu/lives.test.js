import { describe, expect, it, vi } from 'vitest';
import { getRegistry } from '@jackwener/opencli/registry';
import { extractLiveStreamUrl } from './lives.js';
import './lives.js';

const FLV = 'http://live-source-play.xhscdn.com/live/570440785846563714.flv';
const LIVELIST_URL = 'https://www.xiaohongshu.com/livelist?channel_id=&channel_type=explore_feed';

function roomExtraInfo(flv = FLV) {
    return JSON.stringify({
        cover_type: 1,
        live_stream_info: JSON.stringify({
            ver: 103,
            media: { room_id: 570440785846563714 },
            streams: [
                { default_stream: 0, id: 1, master_url: 'http://live.xhscdn.com/backup.flv', protocol: 'flv' },
                { default_stream: 1, id: 5, master_url: flv, protocol: 'flv', quality_type_name: '原画' },
            ],
        }),
    });
}

function storeItem(overrides = {}) {
    return {
        roomIdRaw: '570440785846563714',
        title: '直播间讲透高远球正确鞭打发力',
        host: '羽球小宋老师',
        viewers: 87,
        linkRaw: `xhsdiscover://live_audience?room_id=570440785846563714&flvUrl=${encodeURIComponent(FLV)}&source=live_web_square`,
        roomExtraInfoRaw: roomExtraInfo(),
        ...overrides,
    };
}

function makePage(evaluateResult, currentUrl) {
    const page = {
        goto: vi.fn().mockResolvedValue(undefined),
        wait: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn(async (script) => {
            if (String(script).includes('location.reload')) return undefined;
            return evaluateResult;
        }),
    };
    if (currentUrl !== undefined) page.getCurrentUrl = vi.fn().mockResolvedValue(currentUrl);
    return page;
}

describe('extractLiveStreamUrl', () => {
    it('parses the default stream master_url out of the double-nested JSON', () => {
        expect(extractLiveStreamUrl(roomExtraInfo(), '')).toBe(FLV);
    });
    it('falls back to the flvUrl deeplink param when roomExtraInfo is malformed', () => {
        const link = `xhsdiscover://live_audience?room_id=1&flvUrl=${encodeURIComponent(FLV)}&x=1`;
        expect(extractLiveStreamUrl('not json', link)).toBe(FLV);
        expect(extractLiveStreamUrl('', link)).toBe(FLV);
    });
    it('returns empty when neither source yields a URL', () => {
        expect(extractLiveStreamUrl('', '')).toBe('');
        expect(extractLiveStreamUrl(JSON.stringify({ live_stream_info: '{}' }), 'xhsdiscover://x?a=1')).toBe('');
    });
});

describe('xiaohongshu/lives command', () => {
    const getCommand = () => getRegistry().get('xiaohongshu/lives');

    it('registers persistent with adapter-owned navigation', () => {
        const cmd = getCommand();
        expect(cmd).toBeDefined();
        expect(cmd.navigateBefore).toBe(false);
        expect(cmd.siteSession).toBe('persistent');
    });

    it('maps live-list store rows into playable results', async () => {
        const page = makePage({ items: [storeItem()] });
        const rows = await getCommand().func(page, { limit: 5 });
        expect(rows).toEqual([{
            rank: 1,
            room_id: '570440785846563714',
            title: '直播间讲透高远球正确鞭打发力',
            host: '羽球小宋老师',
            viewers: 87,
            stream_url: FLV,
            url: 'https://www.xiaohongshu.com/livestream/570440785846563714',
        }]);
        expect(page.goto).toHaveBeenCalledWith(LIVELIST_URL);
    });

    it('honors --limit', async () => {
        const page = makePage({ items: [storeItem(), storeItem({ roomIdRaw: '2', title: 'b' }), storeItem({ roomIdRaw: '3', title: 'c' })] });
        const rows = await getCommand().func(page, { limit: 2 });
        expect(rows.length).toBe(2);
    });

    it('forces a reload when the persistent tab already shows the live list', async () => {
        const page = makePage({ items: [storeItem()] }, LIVELIST_URL);
        await getCommand().func(page, { limit: 5 });
        expect(page.goto).not.toHaveBeenCalled();
        expect(page.evaluate).toHaveBeenCalledWith('location.reload()');
    });

    it('retries once through hydration before failing on a missing store', async () => {
        let calls = 0;
        const page = {
            goto: vi.fn().mockResolvedValue(undefined),
            wait: vi.fn().mockResolvedValue(undefined),
            evaluate: vi.fn(async () => (calls++ === 0 ? { error: 'no_live_store' } : { items: [storeItem()] })),
        };
        const rows = await getCommand().func(page, { limit: 5 });
        expect(rows.length).toBe(1);
    });

    it('throws EMPTY_RESULT when no rooms are live', async () => {
        const page = makePage({ items: [] });
        await expect(getCommand().func(page, { limit: 5 })).rejects.toMatchObject({ code: 'EMPTY_RESULT' });
    });
});
