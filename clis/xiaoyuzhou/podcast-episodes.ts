import { cli, Strategy } from '../../src/registry.js';
import { CliError } from '../../src/errors.js';
import { fetchPageProps, formatDuration, formatDate } from './utils.js';

cli({
  site: 'xiaoyuzhou',
  name: 'podcast-episodes',
  description: 'List recent episodes of a Xiaoyuzhou podcast (up to 15, SSR limit)',
  domain: 'www.xiaoyuzhoufm.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'id', positional: true, required: true, help: 'Podcast ID (from xiaoyuzhoufm.com URL)' },
    { name: 'limit', type: 'int', default: 15, help: 'Max episodes to show (up to 15, SSR limit)' },
  ],
  columns: ['eid', 'title', 'duration', 'plays', 'date'],
  func: async (_page, args) => {
    const pageProps = await fetchPageProps(`/podcast/${args.id}`);
    const podcast = pageProps.podcast;
    if (!podcast) throw new CliError('NOT_FOUND', 'Podcast not found', 'Please check the ID');
    const allEpisodes = podcast.episodes ?? [];
    const requestedLimit = Number(args.limit);
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1) {
      throw new CliError('INVALID_ARGUMENT', 'limit must be a positive integer', 'Example: --limit 5');
    }
    const limit = Math.min(requestedLimit, allEpisodes.length);
    const episodes = allEpisodes.slice(0, limit);
    return episodes.map((ep: any) => ({
      eid: ep.eid,
      title: ep.title,
      duration: formatDuration(ep.duration),
      plays: ep.playCount,
      date: formatDate(ep.pubDate),
    }));
  },
});
