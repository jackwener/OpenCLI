/**
 * 36kr article detail — INTERCEPT strategy.
 *
 * Fetches the full content of a 36kr article given its ID or URL.
 */
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import type { IPage } from '@jackwener/opencli/types';

/** Extract article ID from a full URL or a bare numeric ID string */
function parseArticleId(input: string): string {
  const m = input.match(/\/p\/(\d+)/);
  return m ? m[1] : input.replace(/\D/g, '');
}

cli({
  site: '36kr',
  name: 'article',
  description: '获取36氪文章正文内容',
  domain: 'www.36kr.com',
  strategy: Strategy.INTERCEPT,
  args: [
    { name: 'id', positional: true, required: true, help: 'Article ID or full 36kr article URL' },
  ],
  columns: ['field', 'value'],
  func: async (page: IPage, args) => {
    const articleId = parseArticleId(String(args.id ?? ''));
    if (!articleId) {
      throw new CliError('INVALID_ARGUMENT', 'Invalid article ID or URL');
    }

    await page.installInterceptor('36kr.com/api');
    await page.goto(`https://www.36kr.com/p/${articleId}`);
    await page.wait(5);

    const data: any = await page.evaluate(`
      (() => {
        // Title: 36kr uses class "article-title" on h1
        const title = document.querySelector('.article-title, h1')?.textContent?.trim() || '';
        // Author: second .author-name (first is empty nav link, second has real name)
        const authorEls = document.querySelectorAll('.author-name');
        const author = Array.from(authorEls).map(el => el.textContent?.trim()).filter(Boolean)[0] || '';
        // Date: 36kr uses class "title-icon-item item-time" for the publish date
        const dateRaw = document.querySelector('.item-time')?.textContent?.trim() || '';
        const date = dateRaw.replace(/^[·\s]+/, '').trim();
        // Article body paragraphs
        const bodyEls = document.querySelectorAll('[class*="article-content"] p, [class*="rich-text"] p, .article p');
        const body = Array.from(bodyEls)
          .map(el => el.textContent?.trim())
          .filter(t => t && t.length > 10)
          .join(' ')
          .slice(0, 800);
        return { title, author, date, body };
      })()
    `);

    if (!data?.title) {
      throw new CliError('NOT_FOUND', 'Article not found or failed to load', 'Check the article ID');
    }

    return [
      { field: 'title',  value: data.title },
      { field: 'author', value: data.author || '-' },
      { field: 'date',   value: data.date || '-' },
      { field: 'url',    value: `https://36kr.com/p/${articleId}` },
      { field: 'body',   value: data.body || '-' },
    ];
  },
});
