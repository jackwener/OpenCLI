// tvmaze show — full TV show details by TVmaze id.
//
// Hits `https://api.tvmaze.com/shows/<id>`. Returns one row with name, status,
// premiered/ended dates, network, runtime, rating, official site, IMDB / TheTVDB
// cross-refs (so agents can hop into other adapters), and a plain-text summary.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { TVMAZE_BASE, joinList, requireShowId, stripHtml, tvmazeFetch } from './utils.js';

cli({
    site: 'tvmaze',
    name: 'show',
    access: 'read',
    description: 'Single TVmaze TV show detail by id (network, schedule, rating, IMDB/TheTVDB cross-refs)',
    domain: 'tvmaze.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, type: 'int', required: true, help: 'TVmaze show id (positive integer)' },
    ],
    columns: [
        'id', 'name', 'type', 'language', 'genres', 'status',
        'premiered', 'ended', 'runtime', 'averageRuntime', 'network',
        'country', 'schedule', 'rating', 'imdb', 'thetvdb',
        'officialSite', 'summary', 'url',
    ],
    func: async (args) => {
        const id = requireShowId(args.id);
        const show = await tvmazeFetch(`${TVMAZE_BASE}/shows/${id}`, `tvmaze show ${id}`);
        if (!show || show.id == null) {
            throw new EmptyResultError('tvmaze show', `TVmaze returned no show for id ${id}.`);
        }
        const network = show.network?.name ?? show.webChannel?.name ?? '';
        const country = show.network?.country?.name ?? show.webChannel?.country?.name ?? '';
        const days = Array.isArray(show.schedule?.days) ? show.schedule.days.join(', ') : '';
        const time = String(show.schedule?.time ?? '').trim();
        const schedule = days || time ? `${days}${days && time ? ' ' : ''}${time}`.trim() : '';
        return [{
            id: Number(show.id),
            name: String(show.name ?? '').trim(),
            type: String(show.type ?? '').trim(),
            language: String(show.language ?? '').trim(),
            genres: joinList(show.genres),
            status: String(show.status ?? '').trim(),
            premiered: typeof show.premiered === 'string' ? show.premiered : null,
            ended: typeof show.ended === 'string' ? show.ended : null,
            runtime: show.runtime == null ? null : Number(show.runtime),
            averageRuntime: show.averageRuntime == null ? null : Number(show.averageRuntime),
            network: String(network).trim(),
            country: String(country).trim(),
            schedule,
            rating: show.rating?.average == null ? null : Number(show.rating.average),
            imdb: String(show.externals?.imdb ?? '').trim(),
            thetvdb: show.externals?.thetvdb == null ? null : Number(show.externals.thetvdb),
            officialSite: String(show.officialSite ?? '').trim(),
            summary: stripHtml(show.summary),
            url: String(show.url ?? '').trim(),
        }];
    },
});
