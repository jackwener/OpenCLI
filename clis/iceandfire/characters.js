// iceandfire characters — ASOIAF character listing with name / culture / gender filters.
//
// Endpoint: GET /characters?page=N&pageSize=M&name=&culture=&gender=&born=&died=
// `aliases` and `titles` come back as arrays — we join with comma for stable
// column shape; empty arrays normalize to null (not '').
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { paginate, requireBoundedInt, urlToId, IAF_BASE } from './utils.js';

cli({
    site: 'iceandfire',
    name: 'characters',
    access: 'read',
    description: 'ASOIAF character listing (filter by name / culture / gender)',
    domain: 'anapioficeandfire.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Max rows (1-500, default 20)' },
        { name: 'name', help: 'Filter by name substring' },
        { name: 'culture', help: 'Filter by culture (e.g. Northmen, Dornish)' },
        { name: 'gender', help: 'Filter by gender (Male | Female)' },
    ],
    columns: [
        'rank', 'id', 'name', 'gender', 'culture', 'born', 'died',
        'aliases', 'titles', 'allegiances', 'books', 'tvSeries', 'url',
    ],
    func: async (args) => {
        const limit = requireBoundedInt(args.limit, 20, 500);
        const list = await paginate(`${IAF_BASE}/characters`, limit, {
            name: args.name,
            culture: args.culture,
            gender: args.gender,
        }, 'iceandfire characters');
        if (!list.length) {
            throw new EmptyResultError('iceandfire characters', 'anapioficeandfire.com returned no characters for these filters.');
        }
        return list.map((c, i) => {
            const aliases = Array.isArray(c?.aliases) ? c.aliases.filter(Boolean) : [];
            const titles = Array.isArray(c?.titles) ? c.titles.filter(Boolean) : [];
            const tvSeries = Array.isArray(c?.tvSeries) ? c.tvSeries.filter(Boolean) : [];
            return {
                rank: i + 1,
                id: urlToId(c?.url),
                name: c?.name ? c.name : null,                  // null preserves missing-name (some chars use only aliases)
                gender: c?.gender ? c.gender : null,
                culture: c?.culture ? c.culture : null,
                born: c?.born ? c.born : null,
                died: c?.died ? c.died : null,
                aliases: aliases.length ? aliases.join(', ') : null,
                titles: titles.length ? titles.join(', ') : null,
                allegiances: Array.isArray(c?.allegiances) ? c.allegiances.length : null,
                books: Array.isArray(c?.books) ? c.books.length : null,
                tvSeries: tvSeries.length ? tvSeries.join(', ') : null,
                url: c?.url ?? null,
            };
        });
    },
});
