import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import { wikiFetch } from './utils.js';

cli({
  site: 'wikipedia',
  name: 'summary',
  description: 'Get Wikipedia article summary',
  strategy: Strategy.PUBLIC,
  browser: false,
  args: [
    { name: 'title', positional: true, required: true, help: 'Article title (e.g. "Transformer (machine learning model)")' },
    { name: 'lang', default: 'en', help: 'Language code (e.g. en, zh, ja)' },
  ],
  columns: ['title', 'description', 'extract', 'url'],
  func: async (_page, args) => {
    const lang = args.lang || 'en';
    const title = encodeURIComponent(args.title.replace(/ /g, '_'));
    const data = await wikiFetch(lang, `/api/rest_v1/page/summary/${title}`);
    if (!data?.title) throw new CliError('NOT_FOUND', `Article "${args.title}" not found`, 'Try searching first: opencli wikipedia search <keyword>');
    return [{
      title: data.title,
      description: data.description ?? '-',
      extract: (data.extract ?? '').slice(0, 300),
      url: data.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${title}`,
    }];
  },
});
