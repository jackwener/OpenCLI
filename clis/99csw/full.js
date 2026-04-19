import { cli, Strategy } from '@jackwener/opencli/registry';
import { extractChapters, extractChapterContent } from './utils.js';

cli({
  site: '99csw',
  name: 'full',
  description: 'Download complete book content from 99csw.com (with configurable chapter limits)',
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
      name: 'limit',
      type: 'int',
      default: 50,
      help: 'Maximum number of chapters to download (default: 50)',
    },
    {
      name: 'skip',
      type: 'int',
      default: 0,
      help: 'Number of chapters to skip from the beginning',
    },
  ],
  columns: ['chapter_num', 'title', 'content_preview', 'status'],
  func: async (page, kwargs) => {
    if (!page) throw new Error('Browser required for 99csw.com (Cloudflare protection)');

    const bookId = kwargs.book_id;
    const limit = kwargs.limit ?? 50;
    const skip = kwargs.skip ?? 0;
    const indexUrl = `https://www.99csw.com/book/${bookId}/index.htm`;

    try {
      // Step 1: Get chapter list
      await page.goto(indexUrl);
      await page.wait(2);
      const indexHtml = await page.evaluate(`() => {
        return document.documentElement.outerHTML;
      }`);
      const chapters = extractChapters(indexHtml);

      if (chapters.length === 0) {
        throw new Error('No chapters found. Please check if the book_id is correct.');
      }

      console.log(`Found ${chapters.length} chapters, downloading ${Math.min(limit, chapters.length - skip)} chapters...`);

      // Step 2: Download selected chapters
      const selectedChapters = chapters.slice(skip, skip + limit);
      const results = [];

      for (let i = 0; i < selectedChapters.length; i++) {
        const ch = selectedChapters[i];
        const contentUrl = `https://www.99csw.com/book/${bookId}/${ch.id}.htm`;

        try {
          await page.goto(contentUrl);
          await page.wait(1);
          const contentHtml = await page.evaluate(() => document.documentElement.outerHTML);
          const content = extractChapterContent(contentHtml);

          // Create preview (first 100 chars)
          const preview = (content.body || '').substring(0, 100);

          results.push({
            chapter_num: skip + i + 1,
            title: content.title || ch.title,
            content_preview: preview + (content.body && content.body.length > 100 ? '...' : ''),
            status: 'Downloaded',
          });

          // Add small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (err) {
          results.push({
            chapter_num: skip + i + 1,
            title: ch.title,
            content_preview: '',
            status: `Error: ${err.message}`,
          });
        }
      }

      return results;
    } catch (err) {
      throw new Error(`Error downloading book: ${err.message}`);
    }
  },
});
