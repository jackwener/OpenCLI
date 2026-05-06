// ghibli films — Studio Ghibli films catalog.
//
// Endpoint: GET /films
// Server returns the full catalog (~22 films) as one array; client-side slice.
// `rt_score` is Rotten Tomatoes %, `release_date` is YYYY (year only as string).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { ghibliFetch, requireBoundedInt, GHIBLI_BASE } from './utils.js';

cli({
    site: 'ghibli',
    name: 'films',
    access: 'read',
    description: 'Studio Ghibli films (title, director, release year, RT score)',
    domain: 'ghibliapi.vercel.app',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'limit', type: 'int', default: 50, help: 'Max rows (1-50, default 50)' },
    ],
    columns: [
        'rank', 'id', 'title', 'originalTitle', 'originalTitleRomanised',
        'description', 'director', 'producer', 'releaseDate', 'runningTime',
        'rtScore', 'image', 'movieBanner', 'url',
    ],
    func: async (args) => {
        const limit = requireBoundedInt(args.limit, 50, 50);
        const url = `${GHIBLI_BASE}/films`;
        const body = await ghibliFetch(url, 'ghibli films');
        if (!Array.isArray(body) || body.length === 0) {
            throw new EmptyResultError('ghibli films', 'ghibliapi.vercel.app returned no films.');
        }
        // Server order is roughly chronological — sort by release_date ascending
        // for stable presentation regardless of upstream churn.
        const sorted = body.slice().sort((a, b) => {
            const ay = Number(a?.release_date) || 0;
            const by = Number(b?.release_date) || 0;
            return ay - by;
        });
        return sorted.slice(0, limit).map((f, i) => ({
            rank: i + 1,
            id: f?.id ?? null,
            title: f?.title ?? null,
            originalTitle: f?.original_title ?? null,
            originalTitleRomanised: f?.original_title_romanised ?? null,
            description: f?.description ?? null,
            director: f?.director ?? null,
            producer: f?.producer ?? null,
            releaseDate: f?.release_date ?? null,
            runningTime: f?.running_time ?? null,
            rtScore: f?.rt_score ?? null,
            image: f?.image ?? null,
            movieBanner: f?.movie_banner ?? null,
            url: f?.url ?? null,
        }));
    },
});
