import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { ZLIBRARY_DOMAIN, extractBookTitle, extractFormats } from './utils.js';

cli({
  site: 'zlibrary',
  name: 'info',
  description: 'Get book details and available download formats from a Z-Library book page',
  domain: ZLIBRARY_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'url',
      positional: true,
      required: true,
      help: 'Z-Library book page URL (e.g. https://z-library.im/book/...)',
    },
  ],
  columns: ['title', 'pdf', 'epub', 'url'],
  func: async (page, args) => {
    const url = String(args.url || '').trim();
    if (!url.startsWith('http')) {
      throw new CliError('INVALID_ARG', 'URL must start with http', 'Provide the full Z-Library book page URL');
    }

    await page.goto(url, { waitUntil: 'load', settleMs: 3000 });
    await page.wait({ time: 5 });

    const title = await extractBookTitle(page);
    const formats = await extractFormats(page);

    if (!title || title === 'Unknown') {
      throw new CliError(
        'NOT_FOUND',
        'Could not extract book information',
        'Check the URL and that you are logged into Z-Library'
      );
    }

    return [
      {
        title,
        pdf: formats.pdf || '',
        epub: formats.epub || '',
        url,
      },
    ];
  },
});
