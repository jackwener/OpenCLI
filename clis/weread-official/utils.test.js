import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    ArgumentError,
    AuthRequiredError,
    CommandExecutionError,
    EmptyResultError,
    TimeoutError,
} from '@jackwener/opencli/errors';
import {
    SKILL_VERSION,
    WEREAD_GATEWAY_URL,
    buildGatewayBody,
    callGateway,
    emptyResult,
    formatDate,
    formatDuration,
    formatRating,
    formatStar,
    getApiKey,
    makeDeepLink,
    parseRange,
    requireBookId,
    requireChoice,
    requirePositiveInt,
    requireText,
    truncate,
} from './utils.js';

function jsonResponse(body, ok = true, status = 200) {
    return {
        ok,
        status,
        json: vi.fn().mockResolvedValue(body),
        text: vi.fn().mockResolvedValue(JSON.stringify(body)),
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

describe('weread-official utils — formatting', () => {
    it('formats Unix timestamps as YYYY-MM-DD (UTC) and falls back to empty', () => {
        expect(formatDate(1748563200)).toBe('2025-05-30');
        expect(formatDate(0)).toBe('');
        expect(formatDate(null)).toBe('');
        expect(formatDate('not-a-number')).toBe('');
    });

    it('formats duration seconds into "X小时Y分钟" / "Y分钟"', () => {
        expect(formatDuration(3600)).toBe('1小时0分钟');
        expect(formatDuration(3660)).toBe('1小时1分钟');
        expect(formatDuration(59)).toBe('0分钟');
        expect(formatDuration(0)).toBe('0分钟');
        expect(formatDuration(-1)).toBe('');
        expect(formatDuration(null)).toBe('');
    });

    it('translates star multiples-of-20 into ⭐ glyphs (caps at 5)', () => {
        expect(formatStar(20)).toBe('⭐');
        expect(formatStar(80)).toBe('⭐⭐⭐⭐');
        expect(formatStar(100)).toBe('⭐⭐⭐⭐⭐');
        expect(formatStar(120)).toBe('⭐⭐⭐⭐⭐');
        expect(formatStar(0)).toBe('无评分');
        expect(formatStar(-1)).toBe('无评分');
    });

    it('labels ratings by the official 0-1000 tiers', () => {
        expect(formatRating(950)).toMatch(/^神作 95%$/);
        expect(formatRating(820)).toMatch(/^力荐 82%$/);
        expect(formatRating(710)).toMatch(/^好评 71%$/);
        expect(formatRating(550)).toBe('55.0分');
        expect(formatRating(0)).toBe('暂无');
        expect(formatRating(null)).toBe('暂无');
    });

    it('truncates text with an ellipsis suffix and tolerates nullish input', () => {
        expect(truncate('hello', 100)).toBe('hello');
        expect(truncate('1234567890', 5)).toBe('12345…');
        expect(truncate(null, 5)).toBe('');
        expect(truncate(undefined, 5)).toBe('');
    });
});

describe('weread-official utils — deep links', () => {
    it('builds book-level, chapter-level, and bestbookmark URLs', () => {
        expect(makeDeepLink({ bookId: '3300045871' })).toBe('weread://reading?bId=3300045871');
        expect(makeDeepLink({ bookId: '3300045871', chapterUid: '107' })).toBe('weread://reading?bId=3300045871&chapterUid=107');
        expect(makeDeepLink({ bookId: '3300045871', chapterUid: '107', rangeStart: '900', rangeEnd: '2004' }))
            .toBe('weread://bestbookmark?bookId=3300045871&chapterUid=107&rangeStart=900&rangeEnd=2004');
        expect(makeDeepLink({ bookId: '3300045871', chapterUid: '107', rangeStart: '900', rangeEnd: '2004', userVid: '583802764' }))
            .toBe('weread://bestbookmark?bookId=3300045871&chapterUid=107&rangeStart=900&rangeEnd=2004&userVid=583802764');
        expect(makeDeepLink({})).toBe('');
        expect(makeDeepLink({ bookId: '' })).toBe('');
    });

    it('parses ranges like "900-2004" and returns empty on malformed input', () => {
        expect(parseRange('900-2004')).toEqual({ rangeStart: '900', rangeEnd: '2004' });
        expect(parseRange('garbage')).toEqual({ rangeStart: '', rangeEnd: '' });
        expect(parseRange('')).toEqual({ rangeStart: '', rangeEnd: '' });
        expect(parseRange(null)).toEqual({ rangeStart: '', rangeEnd: '' });
    });
});

describe('weread-official utils — argument validation', () => {
    it('rejects empty text and blank bookIds', () => {
        expect(requireText('hello', 'q')).toBe('hello');
        expect(() => requireText('', 'q')).toThrow(ArgumentError);
        expect(() => requireText('   ', 'q')).toThrow(ArgumentError);
        expect(requireBookId('book_123-AbC')).toBe('book_123-AbC');
        expect(() => requireBookId('')).toThrow(ArgumentError);
        expect(() => requireBookId('book id with space')).toThrow(ArgumentError);
    });

    it('enforces positive integers with optional default and max', () => {
        expect(requirePositiveInt(undefined, 'n', { defaultValue: 10 })).toBe(10);
        expect(requirePositiveInt('15', 'n')).toBe(15);
        expect(() => requirePositiveInt('0', 'n')).toThrow(ArgumentError);
        expect(() => requirePositiveInt('-3', 'n')).toThrow(ArgumentError);
        expect(() => requirePositiveInt('abc', 'n')).toThrow(ArgumentError);
        expect(() => requirePositiveInt('200', 'n', { max: 100 })).toThrow(/<= 100/);
    });

    it('requireChoice rejects values outside the allowlist', () => {
        expect(requireChoice('weekly', ['weekly', 'monthly'], 'mode', 'monthly')).toBe('weekly');
        expect(requireChoice(undefined, ['weekly', 'monthly'], 'mode', 'monthly')).toBe('monthly');
        expect(() => requireChoice('quarterly', ['weekly', 'monthly'], 'mode', 'monthly')).toThrow(ArgumentError);
    });
});

describe('weread-official utils — request building', () => {
    it('flattens business params alongside api_name + skill_version', () => {
        const body = buildGatewayBody('/store/search', { keyword: '三体', scope: 10, maxIdx: 0 });
        expect(body.api_name).toBe('/store/search');
        expect(body.skill_version).toBe(SKILL_VERSION);
        expect(body.keyword).toBe('三体');
        expect(body.scope).toBe(10);
        // Empty values should be dropped so the gateway does not see empty strings.
        const body2 = buildGatewayBody('/_list', { foo: '', bar: null, baz: undefined, keep: 'yes' });
        expect(body2).not.toHaveProperty('foo');
        expect(body2).not.toHaveProperty('bar');
        expect(body2).not.toHaveProperty('baz');
        expect(body2.keep).toBe('yes');
    });

    it('rejects empty api_name', () => {
        expect(() => buildGatewayBody('', {})).toThrow(ArgumentError);
        expect(() => buildGatewayBody(null, {})).toThrow(ArgumentError);
    });
});

describe('weread-official utils — auth and callGateway', () => {
    it('throws AuthRequiredError when WEREAD_API_KEY env var is missing', () => {
        vi.stubEnv('WEREAD_API_KEY', '');
        expect(() => getApiKey()).toThrow(AuthRequiredError);
    });

    it('reads and trims WEREAD_API_KEY from env', () => {
        vi.stubEnv('WEREAD_API_KEY', '  wrk-abc  ');
        expect(getApiKey()).toBe('wrk-abc');
    });

    it('posts with Bearer auth and JSON body to the gateway URL', async () => {
        vi.stubEnv('WEREAD_API_KEY', 'wrk-test');
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ errcode: 0, ok: 1 }));
        vi.stubGlobal('fetch', fetchMock);
        const result = await callGateway('/store/search', { keyword: '三体', scope: 10 });
        expect(result).toEqual({ errcode: 0, ok: 1 });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(WEREAD_GATEWAY_URL);
        expect(init.method).toBe('POST');
        expect(init.headers.Authorization).toBe('Bearer wrk-test');
        expect(init.headers['Content-Type']).toBe('application/json');
        const parsed = JSON.parse(init.body);
        expect(parsed.api_name).toBe('/store/search');
        expect(parsed.skill_version).toBe(SKILL_VERSION);
        expect(parsed.keyword).toBe('三体');
    });

    it('maps upgrade_info responses into CommandExecutionError naming both versions', async () => {
        vi.stubEnv('WEREAD_API_KEY', 'wrk-test');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
            upgrade_info: { message: '请升级 skill', required_version: '99.9.9' },
            errcode: 0,
        })));
        await expect(callGateway('/_list', {})).rejects.toThrow(/Required skill_version=99\.9\.9/);
        await expect(callGateway('/_list', {})).rejects.toThrow(/current=/);
    });

    it('maps Bearer-key reject errcodes into AuthRequiredError', async () => {
        vi.stubEnv('WEREAD_API_KEY', 'wrk-test');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ errcode: -2010, errmsg: 'token expired' })));
        await expect(callGateway('/shelf/sync', {})).rejects.toBeInstanceOf(AuthRequiredError);
    });

    it('maps non-zero non-auth errcodes into CommandExecutionError', async () => {
        vi.stubEnv('WEREAD_API_KEY', 'wrk-test');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ errcode: 7, errmsg: 'oops' })));
        await expect(callGateway('/shelf/sync', {})).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('maps HTTP non-2xx into CommandExecutionError', async () => {
        vi.stubEnv('WEREAD_API_KEY', 'wrk-test');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, false, 500)));
        await expect(callGateway('/shelf/sync', {})).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('maps abort signals into TimeoutError', async () => {
        vi.stubEnv('WEREAD_API_KEY', 'wrk-test');
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        await expect(callGateway('/shelf/sync', {})).rejects.toBeInstanceOf(TimeoutError);
    });

    it('maps generic fetch errors into CommandExecutionError', async () => {
        vi.stubEnv('WEREAD_API_KEY', 'wrk-test');
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket hang up')));
        await expect(callGateway('/shelf/sync', {})).rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('refuses to call the gateway without an API key', async () => {
        vi.stubEnv('WEREAD_API_KEY', '');
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(callGateway('/shelf/sync', {})).rejects.toBeInstanceOf(AuthRequiredError);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('weread-official utils — empty-result helper', () => {
    it('throws EmptyResultError with the canonical command label', () => {
        try {
            emptyResult('search', 'No hits');
            expect.unreachable('emptyResult should have thrown');
        }
        catch (error) {
            expect(error).toBeInstanceOf(EmptyResultError);
            expect(error.message).toContain('weread-official search');
        }
    });
});
