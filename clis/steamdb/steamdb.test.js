import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { getRegistry } from '@jackwener/opencli/registry';
import {
    buildCohort,
    cleanRating,
    extractRankingRows,
    parseHoverFragment,
    reduceWeekSeries,
    toDate,
} from './utils.js';
import './rankings.js';
import './rising.js';
import './hot-tags.js';
import './player-gainers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHARTS_FIXTURE = readFileSync(join(__dirname, '__fixtures__/charts.html'), 'utf8');
const WISHLIST_FIXTURE = readFileSync(join(__dirname, '__fixtures__/wishlistactivity.html'), 'utf8');
const HOVER_FIXTURE = readFileSync(join(__dirname, '__fixtures__/app-hover.html'), 'utf8');
const GRAPH_WEEK = JSON.parse(readFileSync(join(__dirname, '__fixtures__/graph-week.json'), 'utf8'));

// Run a page-context function against a JSDOM document, the same way the live
// adapter runs it against the real page via `${fn.toString()}` injection.
function withDom(html, fn) {
    const dom = new JSDOM(html);
    const prevDocument = global.document;
    const prevDOMParser = global.DOMParser;
    global.document = dom.window.document;
    global.DOMParser = dom.window.DOMParser;
    try {
        return fn();
    } finally {
        global.document = prevDocument;
        global.DOMParser = prevDOMParser;
    }
}

describe('steamdb adapters — registration', () => {
    it('registers all four commands as browser UI read commands', () => {
        for (const name of ['rankings', 'rising', 'hot-tags', 'player-gainers']) {
            const cmd = getRegistry().get(`steamdb/${name}`);
            expect(cmd, `steamdb/${name}`).toBeDefined();
            expect(cmd.browser).toBe(true);
            expect(cmd.strategy).toBe('ui');
            expect(cmd.access).toBe('read');
        }
    });
});

describe('extractRankingRows — /charts/ (Most Played) fixture', () => {
    it('reads rank table rows with player metrics from data-sort', () => {
        const { rows } = withDom(CHARTS_FIXTURE, () => extractRankingRows());
        expect(rows).toHaveLength(5);
        const first = rows[0];
        expect(first.appid).toBe('730');
        expect(first.name).toBe('Counter-Strike 2');
        expect(first.currentPlayers).toBe(542976);
        expect(first.peak24h).toBe(1219924);
        expect(first.peakAllTime).toBe(1862531);
        // /charts/ has no store columns — they must be null, not fabricated.
        expect(first.price).toBeNull();
        expect(first.discountPct).toBeNull();
        expect(first.rating).toBeNull();
        expect(first.releaseTs).toBeNull();
        expect(first.gain7d).toBeNull();
    });
});

describe('extractRankingRows — /stats/wishlistactivity/ fixture', () => {
    it('reads the 7d Gain momentum column and store fields', () => {
        const { rows } = withDom(WISHLIST_FIXTURE, () => extractRankingRows());
        expect(rows.length).toBeGreaterThanOrEqual(5);
        const first = rows[0];
        expect(first.appid).toBe('4534960');
        expect(first.name).toBe('Dear Passengers');
        expect(first.releaseTs).toBe(1798675200);
        expect(typeof first.gain7d).toBe('number');
        expect(first.gain7d).toBeGreaterThan(0);
        expect(typeof first.follows).toBe('number');
        // Unpriced app: data-sort="" must stay null, and the -1 rating sentinel
        // must survive extraction raw (cleanRating() nulls it later).
        expect(first.price).toBeNull();
        expect(first.rating).toBe(-1);
        // Every row resolves an appid and a name.
        for (const row of rows) {
            expect(row.appid).toMatch(/^\d+$/);
            expect(row.name).toBeTruthy();
        }
    });
});

describe('parseHoverFragment — RenderAppHover fixture (appid 730)', () => {
    it('parses tags, platforms, developer, microtrailer, screenshots, anti-cheat', () => {
        const detail = withDom('<html></html>', () => parseHoverFragment(HOVER_FIXTURE));
        expect(detail.tags).toContain('FPS');
        expect(detail.tags.length).toBeGreaterThanOrEqual(4);
        // Emoji prefixes must be stripped: every tag starts with a word char.
        for (const tag of detail.tags) {
            expect(tag).toMatch(/^[\p{L}\p{N}]/u);
        }
        expect(detail.platforms).toContain('windows');
        expect(detail.developer).toBe('Valve');
        expect(detail.microtrailer).toMatch(/^https:\/\/video\.fastly\.steamstatic\.com\/store_trailers\/730\/.+microtrailer\.mp4/);
        expect(detail.screenshots).toBeGreaterThan(0);
        expect(detail.antiCheat).toBe('VAC (Valve Anti-Cheat)');
    });
});

describe('reduceWeekSeries — GetGraphWeek fixture', () => {
    it('reduces the hourly series to a momentum summary', () => {
        const summary = reduceWeekSeries(GRAPH_WEEK.data.values);
        expect(summary.points).toBe(GRAPH_WEEK.data.values.length);
        expect(summary.playersNow).toBeGreaterThan(0);
        expect(summary.players7dAgo).toBeGreaterThan(0);
        expect(summary.peakWeek).toBe(Math.max(...GRAPH_WEEK.data.values));
    });

    it('returns null when there is too little history to compare', () => {
        expect(reduceWeekSeries([1, 2, 3])).toBeNull();
        expect(reduceWeekSeries([])).toBeNull();
        expect(reduceWeekSeries(null)).toBeNull();
        expect(reduceWeekSeries(['a', 'b'])).toBeNull();
    });
});

describe('buildCohort — phase filtering and hot->cold ordering', () => {
    const NOW = 1_784_687_755;
    const DAY = 86400;
    const rows = [
        { appid: '1', gain7d: 5, releaseTs: NOW - 400 * DAY },  // old release
        { appid: '2', gain7d: 10, releaseTs: NOW + 30 * DAY },  // upcoming
        { appid: '3', gain7d: null, releaseTs: NOW - DAY },     // no signal
        { appid: '4', gain7d: 7, releaseTs: NOW - 10 * DAY },   // fresh release
        { appid: '5', gain7d: 3, releaseTs: null },             // TBA = upcoming
    ];

    it('drops rows without a gain figure and sorts by gain desc', () => {
        expect(buildCohort(rows, 'all', { now: NOW }).map((r) => r.appid)).toEqual(['2', '4', '1', '5']);
    });

    it('splits released vs upcoming on the release timestamp', () => {
        expect(buildCohort(rows, 'released', { now: NOW }).map((r) => r.appid)).toEqual(['4', '1']);
        expect(buildCohort(rows, 'upcoming', { now: NOW }).map((r) => r.appid)).toEqual(['2', '5']);
    });

    it('new-releases keeps only recent releases within the window', () => {
        expect(buildCohort(rows, 'new-releases', { withinDays: 60, now: NOW }).map((r) => r.appid)).toEqual(['4']);
        expect(buildCohort(rows, 'new-releases', { withinDays: 5, now: NOW })).toEqual([]);
    });
});

describe('scalar helpers', () => {
    it('cleanRating nulls the -1 unrated sentinel and keeps real scores', () => {
        expect(cleanRating(-1)).toBeNull();
        expect(cleanRating(null)).toBeNull();
        expect(cleanRating(0)).toBe(0);
        expect(cleanRating(97.75)).toBe(97.75);
    });

    it('toDate converts unix seconds to YYYY-MM-DD', () => {
        expect(toDate(1345507200)).toBe('2012-08-21');
        expect(toDate(null)).toBeNull();
        expect(toDate(0)).toBeNull();
    });
});

// End-to-end func() runs with a page mock whose evaluate() executes the
// injected page script against the JSDOM fixture — the same source path as the
// live browser.
function createPageMock(onEvaluate) {
    return {
        goto: vi.fn().mockResolvedValue(undefined),
        evaluate: vi.fn(onEvaluate),
    };
}

describe('steamdb/rankings func()', () => {
    const run = (args, page) => getRegistry().get('steamdb/rankings').func(page, args);

    it('maps the charts fixture into flat player metrics + grouped store/detail', async () => {
        const page = createPageMock(async (script) => withDom(CHARTS_FIXTURE, () => eval(script)));
        const rows = await run({ type: 'most-played', limit: 3, detail: false }, page);
        expect(rows).toHaveLength(3);
        expect(rows[0]).toMatchObject({
            rank: 1,
            appid: '730',
            name: 'Counter-Strike 2',
            currentPlayers: 542976,
            peak24h: 1219924,
            peakAllTime: 1862531,
            detail: null,
        });
        expect(rows[0].store).toEqual({
            price: null,
            discountPct: null,
            rating: null,
            releaseDate: null,
            follows: null,
            reviews: null,
        });
        expect(page.goto).toHaveBeenCalledWith(
            'https://steamdb.info/charts/',
            expect.objectContaining({ waitUntil: 'load' }),
        );
    });

    it('rejects an unknown ranking type and an out-of-range limit', async () => {
        const page = createPageMock(async () => ({ rows: [] }));
        await expect(run({ type: 'bogus' }, page)).rejects.toThrow(ArgumentError);
        await expect(run({ type: 'most-played', limit: 0 }, page)).rejects.toThrow(ArgumentError);
        await expect(run({ type: 'most-played', limit: 9999 }, page)).rejects.toThrow(ArgumentError);
    });
});

describe('steamdb/player-gainers func() — throttle fail-fast', () => {
    it('reports a retryable error when every history fetch failed, not an empty result', async () => {
        const page = createPageMock(async (script) => {
            if (script.includes('GetGraphWeek')) {
                // Simulate a fully rate-limited batch.
                const ids = JSON.parse(script.match(/const ids = (\[[^\]]*\])/)[1]);
                return { map: {}, requested: ids.length, ok: 0, failed: ids.length };
            }
            return withDom(CHARTS_FIXTURE, () => eval(script));
        });
        await expect(
            getRegistry().get('steamdb/player-gainers').func(page, { scan: 5, by: 'pct', limit: 5 }),
        ).rejects.toThrow(CommandExecutionError);
        await expect(
            getRegistry().get('steamdb/player-gainers').func(page, { scan: 5, by: 'pct', limit: 5 }),
        ).rejects.toThrow(/rate-limited/);
    });
});
