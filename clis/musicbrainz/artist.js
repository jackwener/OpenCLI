// musicbrainz artist — search the MusicBrainz artist index.
//
// Hits `https://musicbrainz.org/ws/2/artist?query=<query>&fmt=json`. Returns
// the agent-useful projection: MBID (round-trips into `musicbrainz release`
// queries), name, sort name, type (Group / Person / etc.), country, begin/end,
// disambiguation, score.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { MB_BASE, mbFetch, requireBoundedInt, requireString } from './utils.js';

cli({
    site: 'musicbrainz',
    name: 'artist',
    access: 'read',
    description: 'Search MusicBrainz artists by name',
    domain: 'musicbrainz.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Artist name (e.g. "Radiohead", "Aretha Franklin")' },
        { name: 'limit', type: 'int', default: 20, help: 'Max artists (1-100)' },
    ],
    columns: ['rank', 'mbid', 'name', 'sortName', 'type', 'country', 'begin', 'ended', 'disambiguation', 'score', 'url'],
    func: async (args) => {
        const query = requireString(args.query, 'query');
        const limit = requireBoundedInt(args.limit, 20, 100);
        const url = `${MB_BASE}/artist?query=${encodeURIComponent(query)}&limit=${limit}&fmt=json`;
        const body = await mbFetch(url, 'musicbrainz artist');
        const list = Array.isArray(body?.artists) ? body.artists : [];
        if (!list.length) {
            throw new EmptyResultError('musicbrainz artist', `No MusicBrainz artists matched "${query}".`);
        }
        return list.slice(0, limit).map((a, i) => {
            const lifeSpan = a['life-span'] || {};
            const ended = lifeSpan.ended === true ? (lifeSpan.end || 'true') : (lifeSpan.ended === false ? null : (lifeSpan.end || null));
            return {
                rank: i + 1,
                mbid: String(a.id ?? '').trim(),
                name: String(a.name ?? '').trim(),
                sortName: String(a['sort-name'] ?? '').trim(),
                type: String(a.type ?? '').trim() || null,
                country: String(a.country ?? '').trim() || null,
                begin: String(lifeSpan.begin ?? '').trim() || null,
                ended,
                disambiguation: String(a.disambiguation ?? '').trim() || null,
                score: typeof a.score === 'number' ? a.score : null,
                url: a.id ? `https://musicbrainz.org/artist/${a.id}` : '',
            };
        });
    },
});
