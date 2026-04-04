import { cli, Strategy } from '../../src/registry.js';
import { CliError } from '../../src/errors.js';
import { fetchPageProps, formatDate } from './utils.js';

cli({
  site: 'xiaoyuzhou',
  name: 'podcast',
  description: 'View a Xiaoyuzhou podcast profile',
  domain: 'www.xiaoyuzhoufm.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [{ name: 'id', positional: true, required: true, help: 'Podcast ID (from xiaoyuzhoufm.com URL)' }],
  columns: ['title', 'author', 'description', 'subscribers', 'episodes', 'updated'],
  func: async (_page, args) => {
    const pageProps = await fetchPageProps(`/podcast/${args.id}`);
    const p = pageProps.podcast;
    if (!p) throw new CliError('NOT_FOUND', 'Podcast not found', 'Please check the ID');
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
