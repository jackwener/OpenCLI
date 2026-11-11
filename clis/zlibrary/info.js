import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { extractBookTitle, extractFormats, normalizeZlibraryBookUrl } from './utils.js';

cli({
  site: 'zlibrary',
  name: 'info',
  access: 'read',
  description: 'Get book details and available download formats from a Z-Library book page',
  domain: 'z-lib.id',
  strategy: Strategy.COOKIE,
  browser: true,
  navigateBefore: false,
  args: [
    {
      name: 'url',
      positional: true,
      required: true,
      help: 'Z-Library book page URL (e.g. https://z-lib.id/book/...)',
    },
  ],
  columns: ['title', 'pdf', 'epub', 'url'],
  func: async (page, args) => {
    const url = normalizeZlibraryBookUrl(args.url);

    await page.goto(url, { waitUntil: 'load', settleMs: 3000 });
    await page.wait({ time: 5 });

    const title = await extractBookTitle(page);
    const formats = await extractFormats(page);

    if (!title || (!formats.pdf && !formats.epub)) {
      throw new EmptyResultError(
        'zlibrary info',
        'Could not extract a book title and download formats. Check the URL, login state, and whether Z-Library changed its page layout.',
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
