import { describe, expect, it } from 'vitest';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { httpsUrl, parseBvidOrVideoUrl, parseCountText, parseDurationText, parsePageArg, resolveBvid, resolveUid, selectVideoPart } from './utils.js';

describe('parseBvidOrVideoUrl', () => {
    it('preserves exact case-sensitive BVID identity from ids and trusted URLs', () => {
        expect(parseBvidOrVideoUrl(' BV1xx411c7mD ')).toBe('BV1xx411c7mD');
        expect(parseBvidOrVideoUrl('https://www.bilibili.com/video/BV1Je9EBnEha/?p=2')).toBe('BV1Je9EBnEha');
    });

    it('rejects lowercase prefixes, wrong lengths, and untrusted URL lookalikes', () => {
        for (const value of [
            'bv1xx411c7mD',
            'BV123abc',
            'https://evil.example/video/BV1xx411c7mD',
            'https://bilibili.com.evil.example/video/BV1xx411c7mD',
            'https://account.bilibili.com/video/BV1xx411c7mD',
            'http://www.bilibili.com/video/BV1xx411c7mD',
            'https://user@www.bilibili.com/video/BV1xx411c7mD',
            'https://www.bilibili.com/video/BV1xx411c7mD/extra',
        ]) {
            expect(() => parseBvidOrVideoUrl(value)).toThrow(ArgumentError);
        }
    });
});

describe('resolveBvid', () => {
    it('passes through a valid BV ID', async () => {
        expect(await resolveBvid('BV1MV9NBtENN')).toBe('BV1MV9NBtENN');
    });
    it('passes through BV ID with surrounding whitespace', async () => {
        expect(await resolveBvid('  BV1MV9NBtENN  ')).toBe('BV1MV9NBtENN');
    });
    it('handles non-string input via String() coercion', async () => {
        expect(await resolveBvid('BV123abc')).toBe('BV123abc');
    });
    it('extracts BV IDs from bilibili video URLs', async () => {
        expect(await resolveBvid('https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=333.1007')).toBe('BV1xx411c7mD');
        expect(await resolveBvid('https://m.bilibili.com/video/BV1Je9EBnEha')).toBe('BV1Je9EBnEha');
    });
    it('rejects invalid input that cannot be resolved', async () => {
        // A random string that b23.tv won't resolve — should timeout or fail
        await expect(resolveBvid('not-a-valid-code-99999')).rejects.toThrow();
    });
});

describe('resolveUid', () => {
    function pageWithUserSearchResult(result) {
        return {
            evaluate: async (script) => {
                if (String(script).includes('/x/web-interface/nav')) {
                    return {
                        data: {
                            wbi_img: {
                                img_url: 'https://i0.hdslb.com/bfs/wbi/abcdefghijklmnopqrstuvwxyz123456.png',
                                sub_url: 'https://i0.hdslb.com/bfs/wbi/ABCDEFGHIJKLMNOPQRSTUVWXYZ123456.png',
                            },
                        },
                    };
                }
                return result;
            },
        };
    }

    it('returns numeric uid input without searching', async () => {
        expect(await resolveUid({}, '12345')).toBe('12345');
    });

    it('fails closed when user search payload lacks result', async () => {
        await expect(resolveUid(pageWithUserSearchResult({ code: 0, data: {} }), 'missing'))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('fails closed when user search result row lacks mid', async () => {
        await expect(resolveUid(pageWithUserSearchResult({ code: 0, data: { result: [{}] } }), 'missing-mid'))
            .rejects.toBeInstanceOf(CommandExecutionError);
    });

    it('keeps explicit no-user result as EmptyResultError', async () => {
        await expect(resolveUid(pageWithUserSearchResult({ code: 0, data: { result: [] } }), 'nobody'))
            .rejects.toBeInstanceOf(EmptyResultError);
    });
});

describe('parsePageArg', () => {
    it('accepts omitted page and strict positive decimal integers', () => {
        expect(parsePageArg(undefined)).toBeNull();
        expect(parsePageArg(null)).toBeNull();
        expect(parsePageArg('')).toBeNull();
        expect(parsePageArg('1')).toBe(1);
        expect(parsePageArg('12')).toBe(12);
        expect(parsePageArg(3)).toBe(3);
    });

    it('rejects malformed or coerced page values as argument errors', () => {
        for (const value of ['0', '-1', '1.5', '1e2', '0x10', ' 1 ', '01', 'abc', Number.NaN, 1.2]) {
            expect(() => parsePageArg(value)).toThrow(ArgumentError);
        }
    });
});

describe('selectVideoPart', () => {
    it('selects by unique API page number and preserves cid', () => {
        const part = selectVideoPart({
            pages: [
                { page: 1, cid: 1001, part: 'P1' },
                { page: 3, cid: '1003', part: 'P3' },
            ],
        }, 3);
        expect(part).toMatchObject({ page: 3, cid: '1003', part: 'P3' });
    });

    it('fails closed for missing, duplicate, or malformed page identity', () => {
        expect(() => selectVideoPart({ pages: [] }, 1)).toThrow(CommandExecutionError);
        expect(() => selectVideoPart({ pages: [{ page: 1, cid: 1 }, { page: 1, cid: 2 }] }, 1)).toThrow(CommandExecutionError);
        expect(() => selectVideoPart({ pages: [{ page: '1e0', cid: 1 }] }, 1)).toThrow(CommandExecutionError);
        expect(() => selectVideoPart({ pages: [{ page: 1, cid: 0 }] }, 1)).toThrow(CommandExecutionError);
    });
});

describe('parseDurationText', () => {
    it('parses mm:ss and hh:mm:ss display strings into seconds', () => {
        expect(parseDurationText('07:14')).toBe(434);
        expect(parseDurationText('7:14')).toBe(434);
        expect(parseDurationText('24:34')).toBe(1474);
        expect(parseDurationText('1:02:03')).toBe(3723);
    });

    it('accepts four-digit minute totals that search returns for 合集 videos', () => {
        expect(parseDurationText('1413:45')).toBe(84825);
        expect(parseDurationText('2398:14')).toBe(143894);
    });

    it('passes through numbers and returns 0 for anything unparseable', () => {
        expect(parseDurationText(434)).toBe(434);
        expect(parseDurationText('')).toBe(0);
        expect(parseDurationText(undefined)).toBe(0);
        expect(parseDurationText('直播中')).toBe(0);
        expect(parseDurationText('12')).toBe(0);
    });
});

describe('parseCountText', () => {
    it('parses 万 / 亿 display text into numbers', () => {
        expect(parseCountText('1.2万')).toBe(12000);
        expect(parseCountText('3.4亿')).toBe(340000000);
        expect(parseCountText('1234')).toBe(1234);
        expect(parseCountText('1,234')).toBe(1234);
    });

    it('passes through numbers and returns 0 for anything unparseable', () => {
        expect(parseCountText(2483267)).toBe(2483267);
        expect(parseCountText('')).toBe(0);
        expect(parseCountText(undefined)).toBe(0);
        expect(parseCountText('--')).toBe(0);
    });
});

describe('httpsUrl', () => {
    it('upgrades http and protocol-relative image URLs', () => {
        expect(httpsUrl('http://i0.hdslb.com/a.jpg')).toBe('https://i0.hdslb.com/a.jpg');
        expect(httpsUrl('//i0.hdslb.com/a.jpg')).toBe('https://i0.hdslb.com/a.jpg');
        expect(httpsUrl('https://i0.hdslb.com/a.jpg')).toBe('https://i0.hdslb.com/a.jpg');
        expect(httpsUrl(undefined)).toBe('');
    });
});
