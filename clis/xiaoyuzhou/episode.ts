import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { fetchPageProps, formatDuration, formatDate } from './utils.js';

cli({
  site: 'xiaoyuzhou',
  name: 'episode',
  description: 'View details of a Xiaoyuzhou podcast episode',
  domain: 'www.xiaoyuzhoufm.com',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [{ name: 'id', positional: true, required: true, help: 'Episode ID (eid from podcast-episodes output)' }],
  columns: ['title', 'podcast', 'duration', 'plays', 'comments', 'likes', 'date'],
  func: async (_page, args) => {
    const pageProps = await fetchPageProps(`/episode/${args.id}`);
    const ep = pageProps.episode;
    if (!ep) throw new CliError('NOT_FOUND', 'Episode not found', 'Please check the ID');
    return [{
      title: ep.title,
      podcast: ep.podcast?.title,
      duration: formatDuration(ep.duration),
      plays: ep.playCount,
      comments: ep.commentCount,
      likes: ep.clapCount,
      date: formatDate(ep.pubDate),
    }];
  },
});
