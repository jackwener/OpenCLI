import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import type { IPage } from '../../types.js';
import {
  fetchPrivateApi,
  fetchWebApi,
  resolveShelfReader,
  WEREAD_UA,
  WEREAD_WEB_ORIGIN,
} from './utils.js';

interface ReaderFallbackResult {
  title: string;
  author: string;
  publisher: string;
  intro: string;
  category: string;
  rating: string;
  metadataReady: boolean;
}

interface SearchHtmlEntry {
  title: string;
  author: string;
  url: string;
}

function decodeHtmlText(value: string): string {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .trim();
}

function normalizeSearchText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function buildSearchIdentity(title: string, author: string): string {
  return `${normalizeSearchText(title)}\u0000${normalizeSearchText(author)}`;
}

function countSearchTitles(entries: Array<{ title: string }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = normalizeSearchText(entry.title);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function countSearchIdentities(entries: Array<{ title: string; author: string }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = buildSearchIdentity(entry.title, entry.author);
    if (!normalizeSearchText(entry.title) || !normalizeSearchText(entry.author)) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

/**
 * Reuse the public search page as a last-resort reader URL source when the
 * cached shelf page cannot provide a trustworthy bookId-to-reader mapping.
 */
async function resolveSearchReaderUrl(title: string, author: string): Promise<string> {
  const normalizedTitle = normalizeSearchText(title);
  const normalizedAuthor = normalizeSearchText(author);
  if (!normalizedTitle) return '';

  try {
    const [data, htmlEntries] = await Promise.all([
      fetchWebApi('/search/global', { keyword: normalizedTitle }),
      (async (): Promise<SearchHtmlEntry[]> => {
        const url = new URL('/web/search/books', WEREAD_WEB_ORIGIN);
        url.searchParams.set('keyword', normalizedTitle);

        const resp = await fetch(url.toString(), {
          headers: { 'User-Agent': WEREAD_UA },
        });
        if (!resp.ok) return [];

        const html = await resp.text();
        const items = Array.from(
          html.matchAll(/<li[^>]*class="wr_bookList_item"[^>]*>([\s\S]*?)<\/li>/g),
        );

        return items.map((match) => {
          const chunk = match[1];
          const hrefMatch = chunk.match(/<a[^>]*href="([^"]+)"[^>]*class="wr_bookList_item_link"[^>]*>|<a[^>]*class="wr_bookList_item_link"[^>]*href="([^"]+)"[^>]*>/);
          const titleMatch = chunk.match(/<p[^>]*class="wr_bookList_item_title"[^>]*>([\s\S]*?)<\/p>/);
          const authorMatch = chunk.match(/<p[^>]*class="wr_bookList_item_author"[^>]*>([\s\S]*?)<\/p>/);
          const href = hrefMatch?.[1] || hrefMatch?.[2] || '';

          return {
            title: decodeHtmlText(titleMatch?.[1] || ''),
            author: decodeHtmlText(authorMatch?.[1] || ''),
            url: href ? new URL(href, WEREAD_WEB_ORIGIN).toString() : '',
          };
        }).filter((entry) => entry.title && entry.url);
      })(),
    ]);

    const books: any[] = Array.isArray(data?.books) ? data.books : [];
    const apiIdentityCounts = countSearchIdentities(
      books.map((item: any) => ({
        title: item.bookInfo?.title ?? '',
        author: item.bookInfo?.author ?? '',
      })),
    );
    const htmlIdentityCounts = countSearchIdentities(
      htmlEntries.filter((entry) => entry.author),
    );
    const identityKey = buildSearchIdentity(normalizedTitle, normalizedAuthor);
    if (
      normalizedAuthor &&
      (apiIdentityCounts.get(identityKey) || 0) === 1 &&
      (htmlIdentityCounts.get(identityKey) || 0) === 1
    ) {
      const exactMatch = htmlEntries.find((entry) => buildSearchIdentity(entry.title, entry.author) === identityKey);
      if (exactMatch?.url) return exactMatch.url;
    }

    const sameTitleHtmlEntries = htmlEntries.filter((entry) => normalizeSearchText(entry.title) === normalizedTitle);
    if (normalizedAuthor && sameTitleHtmlEntries.some((entry) => normalizeSearchText(entry.author))) {
      return '';
    }

    const apiTitleCounts = countSearchTitles(
      books.map((item: any) => ({ title: item.bookInfo?.title ?? '' })),
    );
    const htmlTitleCounts = countSearchTitles(htmlEntries);
    if ((apiTitleCounts.get(normalizedTitle) || 0) !== 1 || (htmlTitleCounts.get(normalizedTitle) || 0) !== 1) {
      return '';
    }

    return htmlEntries.find((entry) => normalizeSearchText(entry.title) === normalizedTitle)?.url || '';
  } catch {
    return '';
  }
}

/**
 * Read visible book metadata from the web reader cover/flyleaf page.
 * This path is used as a fallback when the private API session has expired.
 */
async function loadReaderFallbackResult(page: IPage, readerUrl: string): Promise<ReaderFallbackResult> {
  await page.goto(readerUrl);
  await page.wait({ selector: '.horizontalReaderCoverPage_content_bookTitle, .wr_flyleaf_page_bookInfo_bookTitle', timeout: 10 });

  const result = await page.evaluate(`
    (() => {
      const text = (node) => node?.textContent?.trim() || '';
      const bodyText = document.body?.innerText?.replace(/\\s+/g, ' ').trim() || '';
      const titleSelector = '.horizontalReaderCoverPage_content_bookTitle, .wr_flyleaf_page_bookInfo_bookTitle';
      const authorSelector = '.horizontalReaderCoverPage_content_author, .wr_flyleaf_page_bookInfo_author';
      const extractRating = () => {
        const match = bodyText.match(/微信读书推荐值\\s*([0-9.]+%)/);
        return match ? match[1] : '';
      };
      const extractPublisher = () => {
        const direct = text(document.querySelector('.introDialog_content_pub_line'));
        return direct.startsWith('出版社') ? direct.replace(/^出版社\\s*/, '').trim() : '';
      };
      const extractIntro = () => {
        const selectors = [
          '.horizontalReaderCoverPage_content_bookInfo_intro',
          '.wr_flyleaf_page_bookIntro_content',
          '.introDialog_content_intro_para',
        ];
        for (const selector of selectors) {
          const value = text(document.querySelector(selector));
          if (value) return value;
        }
        return '';
      };

      const categorySource = Array.from(document.scripts)
        .map((script) => script.textContent || '')
        .find((scriptText) => scriptText.includes('"category"')) || '';
      const categoryMatch = categorySource.match(/"category"\\s*:\\s*"([^"]+)"/);
      const title = text(document.querySelector(titleSelector));
      const author = text(document.querySelector(authorSelector));

      return {
        title,
        author,
        publisher: extractPublisher(),
        intro: extractIntro(),
        category: categoryMatch ? categoryMatch[1].trim() : '',
        rating: extractRating(),
        metadataReady: Boolean(title || author),
      };
    })()
  `) as Partial<ReaderFallbackResult>;

  return {
    title: String(result?.title || '').trim(),
    author: String(result?.author || '').trim(),
    publisher: String(result?.publisher || '').trim(),
    intro: String(result?.intro || '').trim(),
    category: String(result?.category || '').trim(),
    rating: String(result?.rating || '').trim(),
    metadataReady: result?.metadataReady === true,
  };
}

cli({
  site: 'weread',
  name: 'book',
  description: 'View book details on WeRead',
  domain: 'weread.qq.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'book-id', positional: true, required: true, help: 'Book ID from search or shelf results' },
  ],
  columns: ['title', 'author', 'publisher', 'intro', 'category', 'rating'],
  func: async (page: IPage, args) => {
    const bookId = String(args['book-id'] || '').trim();

    try {
      const data = await fetchPrivateApi(page, '/book/info', { bookId });
      // newRating is 0-1000 scale per community docs; needs runtime verification
      const rating = data.newRating ? `${(data.newRating / 10).toFixed(1)}%` : '-';
      return [{
        title: data.title ?? '',
        author: data.author ?? '',
        publisher: data.publisher ?? '',
        intro: data.intro ?? '',
        category: data.category ?? '',
        rating,
      }];
    } catch (error) {
      if (!(error instanceof CliError) || error.code !== 'AUTH_REQUIRED') {
        throw error;
      }

      const { readerUrl: resolvedReaderUrl, snapshot } = await resolveShelfReader(page, bookId);
      let readerUrl = resolvedReaderUrl;
      if (!readerUrl) {
        const cachedBook = snapshot.rawBooks.find((book) => String(book?.bookId || '').trim() === bookId);
        readerUrl = await resolveSearchReaderUrl(
          String(cachedBook?.title || ''),
          String(cachedBook?.author || ''),
        );
      }
      if (!readerUrl) {
        throw error;
      }

      const data = await loadReaderFallbackResult(page, readerUrl);
      if (!data.metadataReady || !data.title) {
        throw error;
      }

      return [{
        title: data.title,
        author: data.author,
        publisher: data.publisher,
        intro: data.intro,
        category: data.category,
        rating: data.rating,
      }];
    }
  },
});
