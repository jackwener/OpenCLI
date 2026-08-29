import { beforeEach, describe, expect, it, vi } from 'vitest';
const { browserFetchMock } = vi.hoisted(() => ({
    browserFetchMock: vi.fn(),
}));
vi.mock('./_shared/browser-fetch.js', () => ({
    browserFetch: browserFetchMock,
}));
import { getRegistry } from '@jackwener/opencli/registry';
import { normalizeAwemeId, sameAwemeId } from './stats.js';

function getCommand() {
    const command = [...getRegistry().values()].find((cmd) => cmd.site === 'douyin' && cmd.name === 'stats');
    if (!command?.func)
        throw new Error('douyin stats command not registered');
    return command;
}

// JSON.parse is what actually rounds the id: the endpoint sends it as a number,
// so the adapter never sees the exact digits. Reproduce that instead of writing
// an out-of-range numeric literal.
const parseId = (digits) => JSON.parse(`{"id":${digits}}`).id;

const METRICS = {
    view_count: '1173',
    bounce_rate_2s: '0.288638',
    completion_rate_5s: '0.515173',
    avg_view_second: '22.987297',
    cover_show: '5',
};

describe('douyin stats registration', () => {
    it('registers the stats command', () => {
        const command = getCommand();
        expect(command).toBeDefined();
        expect(command.args.some((a) => a.name === 'aweme_id')).toBe(true);
    });

    it('has expected columns', () => {
        const command = getCommand();
        expect(command.columns).toContain('metric');
        expect(command.columns).toContain('value');
    });

    it('uses COOKIE strategy', () => {
        expect(getCommand().strategy).toBe('cookie');
    });
});

describe('douyin stats aweme_id handling', () => {
    it('rejects non-numeric and out-of-range ids before fetching', () => {
        expect(normalizeAwemeId('7665918107357121842')).toBe('7665918107357121842');
        expect(() => normalizeAwemeId('abc')).toThrow('16-20 digit');
        expect(() => normalizeAwemeId('123')).toThrow('16-20 digit');
        expect(() => normalizeAwemeId(undefined)).toThrow('16-20 digit');
    });

    it('matches ids the API already rounded to float64 precision', () => {
        // The endpoint returns `id` as a JSON number, so 7665918107357121842
        // arrives as 7665918107357122000 after JSON.parse.
        expect(sameAwemeId(parseId('7665918107357121842'), '7665918107357121842')).toBe(true);
        expect(sameAwemeId('7665918107357121842', '7665918107357121842')).toBe(true);
        expect(sameAwemeId(parseId('7643316353033571594'), '7665918107357121842')).toBe(false);
        expect(sameAwemeId(null, '7665918107357121842')).toBe(false);
    });
});

describe('douyin stats fetching', () => {
    beforeEach(() => {
        browserFetchMock.mockReset();
    });

    it('returns the full metric set as metric/value rows', async () => {
        browserFetchMock.mockResolvedValueOnce({
            items: [{ id: parseId('7665918107357121842'), metrics: METRICS }],
            has_more: false,
        });
        const rows = await getCommand().func({}, { aweme_id: '7665918107357121842' });
        expect(rows).toEqual([
            { metric: 'view_count', value: '1173' },
            { metric: 'bounce_rate_2s', value: '0.288638' },
            { metric: 'completion_rate_5s', value: '0.515173' },
            { metric: 'avg_view_second', value: '22.987297' },
            { metric: 'cover_show', value: '5' },
        ]);
        expect(browserFetchMock).toHaveBeenCalledTimes(1);
        const [, method, url] = browserFetchMock.mock.calls[0];
        expect(method).toBe('GET');
        expect(url).toContain('/web/api/creator/item/list');
        expect(url).toContain('fields=metrics');
    });

    it('walks the cursor until the work is found', async () => {
        browserFetchMock
            .mockResolvedValueOnce({ items: [{ id: parseId('1111111111111111111') }], has_more: true, max_cursor: 42 })
            .mockResolvedValueOnce({ items: [{ id: parseId('7665918107357121842'), metrics: METRICS }], has_more: false });
        const rows = await getCommand().func({}, { aweme_id: '7665918107357121842' });
        expect(rows[0]).toEqual({ metric: 'view_count', value: '1173' });
        expect(browserFetchMock).toHaveBeenCalledTimes(2);
        expect(browserFetchMock.mock.calls[1][2]).toContain('max_cursor=42');
    });

    it('stops paging when the cursor stops advancing', async () => {
        browserFetchMock.mockResolvedValue({ items: [], has_more: true, max_cursor: 7 });
        await expect(getCommand().func({}, { aweme_id: '7665918107357121842' }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT', hint: expect.stringContaining('was not found') });
        // Second hop repeats max_cursor=7, so the walk must stop instead of looping to MAX_HOPS.
        expect(browserFetchMock).toHaveBeenCalledTimes(2);
    });

    it('distinguishes a missing work from a work without metrics', async () => {
        browserFetchMock.mockResolvedValueOnce({
            items: [{ id: parseId('7665918107357121842') }],
            has_more: false,
        });
        await expect(getCommand().func({}, { aweme_id: '7665918107357121842' }))
            .rejects.toMatchObject({ code: 'EMPTY_RESULT', hint: expect.stringContaining('creator metrics are unavailable') });
    });
});
