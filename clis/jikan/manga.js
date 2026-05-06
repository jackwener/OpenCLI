// jikan manga — search manga by title.
//
// Endpoint: GET /v4/manga?q=<query>&limit=<N>
//
// Returns one row per matched series with mal_id, volumes/chapters,
// publication status, score, and url.
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
    name: 'manga',
    access: 'read',
    description: 'Search MyAnimeList manga via Jikan v4',
    domain: 'api.jikan.moe',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Manga title or fragment (e.g. "Berserk")' },
        { name: 'limit', type: 'int', default: 25, help: 'Max rows (1-25, default 25 — Jikan max per page)' },
    ],
    columns: [
        'rank', 'malId', 'title', 'titleEnglish', 'titleJapanese', 'type',
        'chapters', 'volumes', 'status', 'published',
        'score', 'scoredBy', 'malRank', 'popularity', 'genres', 'authors', 'url',
    ],
    func: async (args) => {
        const query = requireString(args.query, 'query');
        const limit = requireBoundedInt(args.limit, 25, 25);
        const url = `${JIKAN_BASE}/manga?q=${encodeURIComponent(query)}&limit=${limit}`;
        const body = await jikanFetch(url, 'jikan manga');
        const list = Array.isArray(body?.data) ? body.data : [];
        if (!list.length) {
            throw new EmptyResultError('jikan manga', `Jikan returned no manga matching "${query}".`);
        }
        return list.slice(0, limit).map((m, i) => ({
            rank: i + 1,
            malId: m.mal_id != null ? Number(m.mal_id) : null,
            title: String(m.title ?? '').trim(),
            titleEnglish: String(m.title_english ?? '').trim(),
            titleJapanese: String(m.title_japanese ?? '').trim(),
            type: String(m.type ?? '').trim(),
            chapters: m.chapters != null ? Number(m.chapters) : null,
            volumes: m.volumes != null ? Number(m.volumes) : null,
            status: String(m.status ?? '').trim(),
            published: String(m.published?.string ?? '').trim(),
            score: m.score != null ? Number(m.score) : null,
            scoredBy: m.scored_by != null ? Number(m.scored_by) : null,
            malRank: m.rank != null ? Number(m.rank) : null,
            popularity: m.popularity != null ? Number(m.popularity) : null,
            genres: joinNamed(m.genres),
            authors: joinNamed(m.authors),
            url: String(m.url ?? '').trim(),
        }));
    },
});
