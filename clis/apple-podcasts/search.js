import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { itunesFetch } from './utils.js';
cli({
    site: 'apple-podcasts',
    name: 'search',
    description: 'Search Apple Podcasts',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'query', positional: true, required: true, help: 'Search keyword' },
        { name: 'limit', type: 'int', default: 10, help: 'Max results' },
    ],
    columns: ['id', 'title', 'author', 'episodes', 'genre', 'url'],
    func: async (_page, args) => {
        const term = encodeURIComponent(args.query);
        const limit = Math.max(1, Math.min(Number(args.limit), 25));
        const data = await itunesFetch(`/search?term=${term}&media=podcast&limit=${limit}`);
        if (!data.results?.length)
            throw new CliError('NOT_FOUND', 'No podcasts found', `Try a different keyword`);
        return data.results.map((p) => ({
            id: p.collectionId,
            title: p.collectionName,
            author: p.artistName,
            episodes: p.trackCount ?? '-',
            genre: p.primaryGenreName ?? '-',
            url: p.collectionViewUrl || '',
        }));
    },
});
