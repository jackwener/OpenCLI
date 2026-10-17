// jiuyangongshe categories — sidebar taxonomy of research categories.
//
// Source: GET https://www.jiuyangongshe.com/
//         The home page renders the category sidebar at `data[0].category[]`.
//         Each entry only carries `{name, value}` where `value` is the
//         category id (an empty string for the "全部" / all-categories
//         pseudo-entry). The SSR block does NOT include per-category post
//         counts or descriptions, so `count` is always null and
//         `description` falls back to a small hand-curated lookup below.
//
// URLs are constructed as
//   https://www.jiuyangongshe.com/study?category_id={id}
// which is the canonical filter URL used elsewhere on the site.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    fetchPage,
    extractNuxtPayload,
    extractCategoryList,
} from './_util.js';

const HOME_URL = 'https://www.jiuyangongshe.com/';

/**
 * Hand-curated descriptions for the four first-class categories plus the
 * "全部" pseudo-entry. Kept inline so the adapter remains self-contained;
 * update both this map and the JSDoc above if the site adds new buckets.
 */
const CATEGORY_DESCRIPTIONS = {
    '全部': 'All categories',
    '个股研究': 'Single-stock research notes',
    '题材行业': 'Theme & sector research',
    '纪要转载': 'Meeting minutes & reposts',
    '资讯荟萃': 'News roundups',
};

cli({
    site: 'jiuyangongshe',
    name: 'categories',
    access: 'read',
    description: 'Research category sidebar on 韭研公社 (jiuyangongshe.com)',
    domain: 'www.jiuyangongshe.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 20, help: 'Max rows to return (default 20, max 50)' },
    ],
    columns: ['id', 'name', 'count', 'description', 'url'],
    func: async (args) => {
        const limit = Math.max(1, Math.min(50, Number(args.limit) || 20));
        const html = await fetchPage(HOME_URL);
        const payload = extractNuxtPayload(html);
        const cats = extractCategoryList(payload);
        if (!cats.length) {
            throw new EmptyResultError(
                'jiuyangongshe categories',
                'No category entries in the SSR data block — site may have changed layout.',
            );
        }

        const rows = [];
        for (let idx = 0; idx < cats.length && rows.length < limit; idx += 1) {
            const cat = cats[idx];
            if (!cat || typeof cat !== 'object') continue;
            const name = typeof cat.name === 'string' ? cat.name : '';
            const rawId = typeof cat.value === 'string' || typeof cat.value === 'number'
                ? String(cat.value)
                : '';
            const id = rawId.trim() === '' ? null : rawId;
            rows.push({
                id,
                name,
                // The home-page SSR payload does not include per-category
                // counts. Surfacing `null` here lets callers distinguish
                // "unknown" from "zero".
                count: null,
                description: CATEGORY_DESCRIPTIONS[name] || '',
                url: id
                    ? `https://www.jiuyangongshe.com/study?category_id=${encodeURIComponent(id)}`
                    : null,
            });
        }

        if (!rows.length) {
            throw new EmptyResultError(
                'jiuyangongshe categories',
                'All category entries were filtered out.',
            );
        }
        return rows;
    },
});