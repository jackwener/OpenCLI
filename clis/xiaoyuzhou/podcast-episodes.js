import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { loadXiaoyuzhouCredentials, requestXiaoyuzhouJson } from './auth.js';
import { formatDuration, formatDate } from './utils.js';
cli({
    site: 'xiaoyuzhou',
    name: 'podcast-episodes',
    access: 'read',
    description: 'List episodes of a Xiaoyuzhou podcast',
    domain: 'www.xiaoyuzhoufm.com',
    strategy: Strategy.LOCAL,
    browser: false,
    args: [
        { name: 'id', positional: true, required: true, help: 'Podcast ID (from xiaoyuzhoufm.com URL)' },
        { name: 'limit', type: 'int', default: 20, help: 'Max episodes to show' },
    ],
    columns: ['eid', 'title', 'duration', 'plays', 'date'],
    func: async (args) => {
        const requestedLimit = Number(args.limit);
        if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
            throw new CliError('INVALID_ARGUMENT', 'limit must be a positive integer', 'Example: --limit 5');
        }
        const credentials = loadXiaoyuzhouCredentials();
        const response = await requestXiaoyuzhouJson('/v1/episode/list', {
            method: 'POST',
            body: { pid: args.id, order: 'desc', limit: requestedLimit },
            credentials,
        });
        const episodes = response.data ?? [];
        if (!Array.isArray(episodes)) {
            throw new CliError('PARSE_ERROR', 'Unexpected API response format', 'Expected an array of episodes');
        }
        return episodes.map((ep) => ({
            eid: ep.eid,
            title: ep.title,
            duration: formatDuration(ep.duration),
            plays: ep.playCount,
            date: formatDate(ep.pubDate),
        }));
    },
});
