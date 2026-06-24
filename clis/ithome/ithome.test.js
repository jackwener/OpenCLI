/**
 * Unit tests for the IT之家 (IThome) adapter.
 *
 * news/rank parse frozen JSON-API fixtures; article parses a frozen SSR page
 * (newsid 968068). No network, no browser.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getRegistry, Strategy } from '@jackwener/opencli/registry';

import {
    NEWS_COLUMNS,
    RANK_COLUMNS,
    ARTICLE_COLUMNS,
    clean,
    stripHtml,
    decodeEntities,
    requireLimit,
    fmtDateTime,
    normalizeArticle,
    articleUrl,
} from './utils.js';
import { parseNewsRows } from './news.js';
import { parseRankRows } from './rank.js';
import { parseArticleRows } from './article.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fx = (name) => readFileSync(join(__dirname, '__fixtures__', name), 'utf8');
const NEWS = JSON.parse(fx('news.json'));
const RANK = JSON.parse(fx('rank.json'));
const ARTICLE = fx('article.html');

describe('ithome news', () => {
    it('parses news rows with newsid / title / counts / url', () => {
        const rows = parseNewsRows(NEWS, 20);
        expect(rows.length).toBeGreaterThan(0);
        expect(Object.keys(rows[0])).toEqual(NEWS_COLUMNS);
        const r = rows[0];
        expect(r.newsid).toMatch(/^\d+$/);
        expect(r.title).toBeTruthy();
        expect(typeof r.hits).toBe('number');
        expect(typeof r.comments).toBe('number');
        expect(r.url).toMatch(/^https:\/\/www\.ithome\.com\/0\/\d+\/\d+\.htm$/);
        expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    });

    it('dedupes by newsid, respects the limit, [] for empty', () => {
        const ids = parseNewsRows(NEWS, 50).map((r) => r.newsid);
        expect(new Set(ids).size).toBe(ids.length);
        expect(parseNewsRows(NEWS, 3).length).toBeLessThanOrEqual(3);
        expect(parseNewsRows({}, 20)).toEqual([]);
    });
});

describe('ithome rank', () => {
    it('parses ranked rows tagged by board, with hits/comments', () => {
        const rows = parseRankRows(RANK, { board: null, limit: 80 });
        expect(rows.length).toBeGreaterThan(0);
        expect(Object.keys(rows[0])).toEqual(RANK_COLUMNS);
        expect(rows[0].rank).toBe(1);
        expect(typeof rows[0].hits).toBe('number');
        expect(new Set(rows.map((r) => r.board)).size).toBeGreaterThan(1);
    });

    it('filters by board and respects the limit', () => {
        const wk = parseRankRows(RANK, { board: '评论', limit: 80 });
        expect(wk.length).toBeGreaterThan(0);
        expect(wk.every((r) => r.board.includes('评论'))).toBe(true);
        expect(parseRankRows(RANK, { board: null, limit: 3 }).length).toBeLessThanOrEqual(3);
        expect(parseRankRows(RANK, { board: '不存在', limit: 80 })).toEqual([]);
    });
});

describe('ithome article', () => {
    it('parses 标题 + 正文 paragraphs', () => {
        const rows = parseArticleRows(ARTICLE);
        expect(rows.length).toBeGreaterThan(1);
        expect(Object.keys(rows[0])).toEqual(ARTICLE_COLUMNS);
        expect(rows[0].field).toBe('标题');
        expect(rows[0].value).not.toMatch(/IT之家$/);
        const bodyRows = rows.filter((r) => r.field === '正文');
        expect(bodyRows.length).toBeGreaterThan(0);
        expect(rows.every((r) => !/[<>]/.test(r.value))).toBe(true);
    });

    it('returns [] for empty html', () => {
        expect(parseArticleRows('')).toEqual([]);
    });
});

describe('ithome utils', () => {
    it('normalizeArticle maps newsid <-> url', () => {
        expect(normalizeArticle('968068')).toEqual({ newsid: '968068', url: 'https://www.ithome.com/0/968/068.htm' });
        expect(normalizeArticle('https://www.ithome.com/0/968/068.htm')).toEqual({ newsid: '968068', url: 'https://www.ithome.com/0/968/068.htm' });
        expect(() => normalizeArticle('abc')).toThrow();
        expect(() => normalizeArticle('')).toThrow();
    });

    it('fmtDateTime + articleUrl normalize', () => {
        expect(fmtDateTime('2026-06-24T17:22:21.723')).toBe('2026-06-24 17:22');
        expect(articleUrl('/0/968/068.htm')).toBe('https://www.ithome.com/0/968/068.htm');
        expect(articleUrl('https://www.ithome.com/0/1/2.htm')).toBe('https://www.ithome.com/0/1/2.htm');
    });

    it('requireLimit clamps; clean/stripHtml/decodeEntities normalize', () => {
        expect(requireLimit(undefined, 20, 50)).toBe(20);
        expect(() => requireLimit(0, 20, 50)).toThrow();
        expect(() => requireLimit(99, 20, 50)).toThrow();
        expect(clean('  a\n b ')).toBe('a b');
        expect(stripHtml('<p>x</p><p>y</p>')).toBe('x y');
        expect(decodeEntities('A&nbsp;B&#65;')).toBe('A BA');
    });
});

describe('ithome command registration', () => {
    it('registers news / rank / article as PUBLIC read commands', () => {
        const reg = getRegistry();
        for (const name of ['news', 'rank', 'article']) {
            const cmd = reg.get(`ithome/${name}`);
            expect(cmd, `ithome ${name} registered`).toBeTruthy();
            expect(cmd.strategy).toBe(Strategy.PUBLIC);
            expect(cmd.browser).toBe(false);
            expect(cmd.access).toBe('read');
        }
    });
});
