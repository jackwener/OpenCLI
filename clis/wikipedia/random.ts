import { CliError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { type WikiSummary, formatSummaryRow, wikiFetch } from './utils.js';

cli({
  site: 'wikipedia',
  name: 'random',
  description: 'Get a random Wikipedia article',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [{ name: 'lang', default: 'en', help: 'Language code (e.g. en, zh, ja)' }],
  columns: ['title', 'description', 'extract', 'url'],
  func: async (_page, args) => {
    const lang = args.lang || 'en';
    const data = (await wikiFetch(lang, '/api/rest_v1/page/random/summary')) as WikiSummary;
    if (!data?.title) throw new CliError('NOT_FOUND', 'No random article returned', 'Try again');
    return [formatSummaryRow(data, lang)];
  },
});
