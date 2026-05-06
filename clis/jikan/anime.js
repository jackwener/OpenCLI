// jikan anime — search anime by title.
//
// Endpoint: GET /v4/anime?q=<query>&limit=<N>
//
// Returns one row per matched series with mal_id (round-trips into
// `jikan detail`), score, episodes, status, season, studios, and url.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    JIKAN_BASE,
    jikanFetch,
    joinNamed,
    requireBoundedInt,
    requireString,
} from './utils.js';

cli({
    site: 'jikan',
    name: 'anime',
    access: 'read',
    description: 'Search MyAnimeList anime via Jikan v4',
    domain: 'api.jikan.moe',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Anime title or fragment (e.g. "Cowboy Bebop")' },
        { name: 'limit', type: 'int', default: 25, help: 'Max rows (1-25, default 25 — Jikan max per page)' },
    ],
    columns: [
        'rank', 'malId', 'title', 'titleEnglish', 'titleJapanese', 'type',
        'episodes', 'status', 'aired', 'duration', 'rating', 'score', 'scoredBy',
        'malRank', 'popularity', 'genres', 'studios', 'url',
    ],
    func: async (args) => {
        const query = requireString(args.query, 'query');
        const limit = requireBoundedInt(args.limit, 25, 25);
        const url = `${JIKAN_BASE}/anime?q=${encodeURIComponent(query)}&limit=${limit}`;
        const body = await jikanFetch(url, 'jikan anime');
        const list = Array.isArray(body?.data) ? body.data : [];
        if (!list.length) {
            throw new EmptyResultError('jikan anime', `Jikan returned no anime matching "${query}".`);
        }
        return list.slice(0, limit).map((a, i) => ({
            rank: i + 1,
            malId: a.mal_id != null ? Number(a.mal_id) : null,
            title: String(a.title ?? '').trim(),
            titleEnglish: String(a.title_english ?? '').trim(),
            titleJapanese: String(a.title_japanese ?? '').trim(),
            type: String(a.type ?? '').trim(),
            episodes: a.episodes != null ? Number(a.episodes) : null,
            status: String(a.status ?? '').trim(),
            aired: String(a.aired?.string ?? '').trim(),
            duration: String(a.duration ?? '').trim(),
            rating: String(a.rating ?? '').trim(),
            score: a.score != null ? Number(a.score) : null,
            scoredBy: a.scored_by != null ? Number(a.scored_by) : null,
            malRank: a.rank != null ? Number(a.rank) : null,
            popularity: a.popularity != null ? Number(a.popularity) : null,
            genres: joinNamed(a.genres),
            studios: joinNamed(a.studios),
            url: String(a.url ?? '').trim(),
        }));
    },
});
