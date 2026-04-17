import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { loadXiaoyuzhouCredentials, requestXiaoyuzhouJson } from './auth.js';
import { formatDate } from './utils.js';
cli({
    site: 'xiaoyuzhou',
    name: 'podcast',
    description: 'View a Xiaoyuzhou podcast profile',
    domain: 'www.xiaoyuzhoufm.com',
    strategy: Strategy.LOCAL,
    browser: false,
    args: [{ name: 'id', positional: true, required: true, help: 'Podcast ID (from xiaoyuzhoufm.com URL)' }],
    columns: ['title', 'author', 'description', 'subscribers', 'episodes', 'updated'],
    func: async (_page, args) => {
        const credentials = loadXiaoyuzhouCredentials();
        const response = await requestXiaoyuzhouJson('/v1/podcast/get', {
            query: { pid: args.id },
            credentials,
        });
        const p = response.data;
        if (!p)
            throw new CliError('NOT_FOUND', 'Podcast not found', 'Please check the ID');
        return [{
                title: p.title,
                author: p.author,
                description: p.brief,
                subscribers: p.subscriptionCount,
                episodes: p.episodeCount,
                updated: formatDate(p.latestEpisodePubDate),
            }];
    },
});
