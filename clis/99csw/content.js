import { cli, Strategy } from '@jackwener/opencli/registry';
import { extractChapterContent } from './utils.js';

cli({
  site: '99csw',
  name: 'content',
  description: 'Get the content of a specific chapter from 99csw.com',
  domain: 'www.99csw.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    {
      name: 'book_id',
      type: 'string',
      required: true,
      positional: true,
      help: 'Book ID (e.g., 9210)',
    },
    {
      name: 'chapter_id',
      type: 'string',
      required: true,
      positional: true,
      help: 'Chapter ID (e.g., 328790)',
    },
  ],
  columns: ['title', 'content'],
  func: async (page, kwargs) => {
    if (!page) throw new Error('Browser required for 99csw.com (Cloudflare protection)');

    const bookId = kwargs.book_id;
    const chapterId = kwargs.chapter_id;
    const url = `https://www.99csw.com/book/${bookId}/${chapterId}.htm`;

    try {
      await page.goto(url);
      await page.wait(2);

      // Extract HTML from browser
      const html = await page.evaluate(`() => {
        return document.documentElement.outerHTML;
      }`);
      const content = extractChapterContent(html);

      if (!content.body) {
        throw new Error('Could not extract chapter content. The page may not be accessible.');
      }

      return [
        {
          title: content.title || `Chapter ${chapterId}`,
          content: content.body,
        },
      ];
    } catch (err) {
      throw new Error(`Error fetching chapter content: ${err.message}`);
    }
  },
});
