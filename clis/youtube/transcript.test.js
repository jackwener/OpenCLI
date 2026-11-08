/**
 * YouTube transcript — innertube caption fallback (#2648).
 *
 * The page-context script is executed against a JSDOM window with a scripted
 * fetch so the ANDROID/IOS client order, language selection, json3 parsing and
 * the null-on-failure contract are covered offline.
 */
import { describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { fetchInnertubeCaptionSegments, pickCaptionTrack } from './transcript.js';

const TRACK_EN = { languageCode: 'en', kind: '', baseUrl: 'https://www.youtube.com/api/timedtext?v=abc123&lang=en' };
const TRACK_ZH = { languageCode: 'zh-Hans', kind: '', baseUrl: 'https://www.youtube.com/api/timedtext?v=abc123&lang=zh-Hans' };
const TRACK_EN_ASR = { languageCode: 'en', kind: 'asr', baseUrl: 'https://www.youtube.com/api/timedtext?v=abc123&lang=en&kind=asr' };

const JSON3_BODY = JSON.stringify({
    events: [
        { tStartMs: 0, dDurationMs: 1500, segs: [{ utf8: 'hello ' }, { utf8: 'world' }] },
        { tStartMs: 1500, dDurationMs: 500, segs: [{ utf8: 'again' }] },
        { tStartMs: 2000, dDurationMs: 500, segs: [] },
    ],
});

function playerResponse(tracks) {
    return { captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } } };
}

function okJson(value) {
    return { ok: true, status: 200, json: async () => value, text: async () => '' };
}

function okText(value) {
    return { ok: true, status: 200, json: async () => null, text: async () => value };
}

function pageWithFetch(handler) {
    const dom = new JSDOM('', { url: 'https://www.youtube.com/', runScripts: 'outside-only' });
    const fetchMock = vi.fn(handler);
    dom.window.fetch = fetchMock;
    return { dom, fetchMock, page: { evaluate: vi.fn(async (script) => dom.window.eval(script)) } };
}

function isPlayerRequest(url) {
    return String(url).includes('/youtubei/v1/player');
}

describe('pickCaptionTrack', () => {
    it('prefers an exact language match, then a prefix match', () => {
        expect(pickCaptionTrack([TRACK_EN, TRACK_ZH], 'zh-Hans')).toBe(TRACK_ZH);
        expect(pickCaptionTrack([TRACK_EN, TRACK_ZH], 'zh')).toBe(TRACK_ZH);
    });

    it('falls back to the first manual track, then the first track', () => {
        expect(pickCaptionTrack([TRACK_EN_ASR, TRACK_EN], '')).toBe(TRACK_EN);
        expect(pickCaptionTrack([TRACK_EN_ASR], '')).toBe(TRACK_EN_ASR);
        expect(pickCaptionTrack([], 'en')).toBeNull();
    });
});

describe('fetchInnertubeCaptionSegments', () => {
    it('requests the caption track through the ANDROID innertube client and parses json3', async () => {
        const { page, fetchMock } = pageWithFetch(async (url) => {
            if (isPlayerRequest(url)) return okJson(playerResponse([TRACK_EN]));
            return okText(JSON3_BODY);
        });
        const segments = await fetchInnertubeCaptionSegments(page, 'abc123', '');
        expect(segments).toEqual([
            { start: 0, end: 1.5, text: 'hello world' },
            { start: 1.5, end: 2, text: 'again' },
        ]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[0][1].headers['X-YouTube-Client-Name']).toBe('3');
        expect(String(fetchMock.mock.calls[1][0])).toContain('fmt=json3');
    });

    it('falls back to the IOS client when ANDROID is rejected', async () => {
        const { page, fetchMock } = pageWithFetch(async (url, init) => {
            if (isPlayerRequest(url)) {
                return init.headers['X-YouTube-Client-Name'] === '5'
                    ? okJson(playerResponse([TRACK_EN]))
                    : { ok: false, status: 400, json: async () => ({}), text: async () => '' };
            }
            return okText(JSON3_BODY);
        });
        const segments = await fetchInnertubeCaptionSegments(page, 'abc123', '');
        expect(segments).not.toBeNull();
        expect(segments).toHaveLength(2);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(fetchMock.mock.calls[1][1].headers['X-YouTube-Client-Name']).toBe('5');
    });

    it('returns null when every client fails so later fallbacks still run', async () => {
        const { page, fetchMock } = pageWithFetch(async () => ({ ok: false, status: 400, json: async () => ({}), text: async () => '' }));
        const segments = await fetchInnertubeCaptionSegments(page, 'abc123', '');
        expect(segments).toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('returns null when the caption body is empty', async () => {
        const { page } = pageWithFetch(async (url) => (
            isPlayerRequest(url) ? okJson(playerResponse([TRACK_EN])) : okText('')
        ));
        const segments = await fetchInnertubeCaptionSegments(page, 'abc123', '');
        expect(segments).toBeNull();
    });

    it('selects the requested language from the innertube tracks', async () => {
        const { page, fetchMock } = pageWithFetch(async (url) => {
            if (isPlayerRequest(url)) return okJson(playerResponse([TRACK_EN, TRACK_ZH]));
            return okText(JSON3_BODY);
        });
        await fetchInnertubeCaptionSegments(page, 'abc123', 'zh-Hans');
        expect(String(fetchMock.mock.calls[1][0])).toContain('lang=zh-Hans');
    });

    it('returns null when page evaluation itself fails', async () => {
        const page = { evaluate: vi.fn(async () => { throw new Error('page gone'); }) };
        await expect(fetchInnertubeCaptionSegments(page, 'abc123', '')).resolves.toBeNull();
    });
});
