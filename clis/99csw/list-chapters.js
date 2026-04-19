import { cli, Strategy } from '@jackwener/opencli/registry';
import { extractChapters, extractBookMetadata } from './utils.js';

cli({
  site: '99csw',
  name: 'list-chapters',
  description: 'List all chapters of a book from 99csw.com (Nine Nine Cang Shu Wang)',
  domain: 'www.99csw.com',
  strategy: Strategy.COOKIE,
  browser: true,
  args: [
    {
      name: 'book_id',
      type: 'string',
      required: true,
      positional: true,
      help: 'Book ID (number from URL, e.g., 9210 from /book/9210/index.htm)',
    },
  ],
  columns: ['rank', 'chapter_id', 'title'],
  func: async (page, kwargs) => {
    const bookId = kwargs.book_id;
    const url = `https://www.99csw.com/book/${bookId}/index.htm`;

    if (!page) throw new Error('Browser required for 99csw.com (Cloudflare protection)');

    try {
      await page.goto(url);
      await page.wait(2); // Wait for page to load

      // Extract HTML from browser
      const html = await page.evaluate(`() => {
        return document.documentElement.outerHTML;
      }`);

      // Extract all chapters
      const chapters = extractChapters(html);

      if (chapters.length === 0) {
        throw new Error('No chapters found. Please check if the book_id is correct.');
      }

      // Return formatted chapter list
      return chapters.map((ch, i) => ({
        rank: i + 1,
        chapter_id: ch.id,
        title: ch.title,
      }));
    } catch (err) {
      throw new Error(`Error fetching book chapters: ${err.message}`);
    }
  },
});
