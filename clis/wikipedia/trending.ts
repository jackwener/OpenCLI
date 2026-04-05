import { CliError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { DESC_MAX_LEN, type WikiMostReadArticle, wikiFetch } from './utils.js';

cli({
  site: 'wikipedia',
  name: 'trending',
  description: 'Most-read Wikipedia articles (yesterday)',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'limit', type: 'int', default: 10, help: 'Max results' },
    { name: 'lang', default: 'en', help: 'Language code (e.g. en, zh, ja)' },
  ],
  columns: ['rank', 'title', 'description', 'views'],
  func: async (_page, args) => {
    const lang = args.lang || 'en';
    const limit = Math.max(1, Math.min(Number(args.limit), 50));

    // Use yesterday's UTC date — Wikipedia API expects UTC and yesterday
    // guarantees data availability (today's aggregation may be incomplete).
    const d = new Date(Date.now() - 86_400_000);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');

    const data = (await wikiFetch(lang, `/api/rest_v1/feed/featured/${yyyy}/${mm}/${dd}`)) as {
      mostread?: { articles?: WikiMostReadArticle[] };
    };
    const articles = data?.mostread?.articles;
    if (!articles?.length)
      throw new CliError('NOT_FOUND', 'No trending articles available', 'Try a different language with --lang');

    return articles.slice(0, limit).map((a, i) => ({
      rank: i + 1,
      title: a.title ?? '-',
      description: (a.description ?? '-').slice(0, DESC_MAX_LEN),
      views: a.views ?? 0,
    }));
  },
});
