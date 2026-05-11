import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { itunesFetch, formatDuration, formatDate } from './utils.js';
cli({
    site: 'apple-podcasts',
    name: 'episodes',
    access: 'read',
    description: 'List recent episodes of an Apple Podcast (use ID from search)',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Podcast ID (collectionId from search output)' },
        { name: 'limit', type: 'int', default: 15, help: 'Max episodes to show' },
    ],
    columns: ['title', 'duration', 'date'],
    func: async (args) => {
        const limit = Math.max(1, Math.min(Number(args.limit), 200));
        // results[0] is the podcast itself; the rest are episodes
        const data = await itunesFetch(`/lookup?id=${args.id}&entity=podcastEpisode&limit=${limit + 1}`);
        const episodes = (data.results ?? []).filter((r) => r.kind === 'podcast-episode');
        if (!episodes.length)
            throw new CliError('NOT_FOUND', 'No episodes found', 'Check the podcast ID from: opencli apple-podcasts search <keyword>');
        return episodes.slice(0, limit).map((ep) => ({
            title: ep.trackName,
            duration: formatDuration(ep.trackTimeMillis),
            date: formatDate(ep.releaseDate),
        }));
    },
});
