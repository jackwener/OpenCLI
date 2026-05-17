/**
 * 12306 station search.
 *
 * Queries the public `station_name.js` bundle and filters by the user's
 * keyword. Anonymous, no session needed.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { fetchStationBundle } from './utils.js';

const MAX_LIMIT = 50;

function normalizeLimit(value, defaultValue, max) {
    if (value === undefined || value === null || value === '') return defaultValue;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) {
        throw new ArgumentError(`limit must be a positive integer (1-${max})`);
    }
    if (n > max) {
        throw new ArgumentError(`limit must be <= ${max}`);
    }
    return n;
}

cli({
    site: '12306',
    name: 'stations',
    access: 'read',
    description: 'Search 12306 (China Railway) stations by Chinese name, telecode, or pinyin keyword',
    domain: 'kyfw.12306.cn',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'keyword', positional: true, required: true, help: 'Chinese substring (上海), telecode (AOH), or pinyin (shanghai)' },
        { name: 'limit', type: 'int', default: 20, help: `Maximum results (1-${MAX_LIMIT})` },
    ],
    columns: ['name', 'code', 'pinyin', 'abbr', 'city'],
    func: async (kwargs) => {
        const keyword = String(kwargs.keyword ?? '').trim();
        if (!keyword) throw new ArgumentError('keyword must not be empty');
        const limit = normalizeLimit(kwargs.limit, 20, MAX_LIMIT);

        const stations = await fetchStationBundle();
        const lower = keyword.toLowerCase();
        const matches = stations.filter((s) =>
            s.name.includes(keyword)
            || s.code === keyword.toUpperCase()
            || s.pinyin.includes(lower)
            || s.abbr.includes(lower)
            || s.short.includes(lower)
            || s.city.includes(keyword),
        );
        if (matches.length === 0) {
            throw new EmptyResultError(`No 12306 stations match "${keyword}"`);
        }
        return matches.slice(0, limit).map((s) => ({
            name: s.name,
            code: s.code,
            pinyin: s.pinyin,
            abbr: s.abbr,
            city: s.city,
        }));
    },
});

export const __test__ = { normalizeLimit };
