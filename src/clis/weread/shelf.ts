import { cli, Strategy } from '../../registry.js';
import { CliError } from '../../errors.js';
import type { IPage } from '../../types.js';
import { fetchPrivateApi } from './utils.js';

const WEREAD_DOMAIN = 'weread.qq.com';
const WEREAD_SHELF_URL = `https://${WEREAD_DOMAIN}/web/shelf`;

interface ShelfRow {
  title: string;
  author: string;
  progress: string;
  bookId: string;
}

interface WebShelfRawBook {
  bookId?: string;
  title?: string;
  author?: string;
}

interface WebShelfIndexEntry {
  bookId?: string;
  idx?: number;
  role?: string;
}

interface WebShelfSnapshot {
  cacheFound: boolean;
  rawBooks: WebShelfRawBook[];
  shelfIndexes: WebShelfIndexEntry[];
}

function normalizeShelfLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 0;
  return Math.max(0, Math.trunc(limit));
}

function normalizePrivateApiRows(data: any, limit: number): ShelfRow[] {
  const books: any[] = data?.books ?? [];
  return books.slice(0, limit).map((item: any) => ({
    title: item.bookInfo?.title ?? item.title ?? '',
    author: item.bookInfo?.author ?? item.author ?? '',
    // TODO: readingProgress field name from community docs, verify with real API response
    progress: item.readingProgress != null ? `${item.readingProgress}%` : '-',
    bookId: item.bookId ?? item.bookInfo?.bookId ?? '',
  }));
}

function normalizeWebShelfRows(snapshot: WebShelfSnapshot, limit: number): ShelfRow[] {
  if (limit <= 0) return [];

  const bookById = new Map<string, WebShelfRawBook>();
  for (const book of snapshot.rawBooks) {
    const bookId = String(book?.bookId || '').trim();
    if (!bookId) continue;
    bookById.set(bookId, book);
  }

  const orderedBookIds = snapshot.shelfIndexes
    .filter((entry) => String(entry?.role || 'book') === 'book')
    .sort((left, right) => Number(left?.idx ?? Number.MAX_SAFE_INTEGER) - Number(right?.idx ?? Number.MAX_SAFE_INTEGER))
    .map((entry) => String(entry?.bookId || '').trim())
    .filter(Boolean);

  const fallbackOrder = snapshot.rawBooks
    .map((book) => String(book?.bookId || '').trim())
    .filter(Boolean);

  const orderedUniqueBookIds = Array.from(new Set([
    ...orderedBookIds,
    ...fallbackOrder,
  ]));

  return orderedUniqueBookIds
    .map((bookId) => {
      const book = bookById.get(bookId);
      if (!book) return null;
      return {
        title: String(book.title || '').trim(),
        author: String(book.author || '').trim(),
        progress: '-',
        bookId,
      } satisfies ShelfRow;
    })
    .filter((item): item is ShelfRow => Boolean(item && (item.title || item.bookId)))
    .slice(0, limit);
}

/**
 * Read the structured shelf cache from the web shelf page.
 * The page hydrates localStorage with raw book data plus shelf ordering.
 */
async function loadWebShelfSnapshot(page: IPage): Promise<WebShelfSnapshot> {
  await page.goto(WEREAD_SHELF_URL);

  const cookies = await page.getCookies({ domain: WEREAD_DOMAIN });
  const currentVid = String(cookies.find((cookie) => cookie.name === 'wr_vid')?.value || '').trim();

  if (!currentVid) {
    return { cacheFound: false, rawBooks: [], shelfIndexes: [] };
  }

  const rawBooksKey = `shelf:rawBooks:${currentVid}`;
  const shelfIndexesKey = `shelf:shelfIndexes:${currentVid}`;

  const result = await page.evaluate(`
    (() => new Promise((resolve) => {
      const deadline = Date.now() + 5000;
      const rawBooksKey = ${JSON.stringify(rawBooksKey)};
      const shelfIndexesKey = ${JSON.stringify(shelfIndexesKey)};

      const readJson = (raw) => {
        if (typeof raw !== 'string') return null;
        try {
          return JSON.parse(raw);
        } catch {
          return null;
        }
      };

      const poll = () => {
        const rawBooksRaw = localStorage.getItem(rawBooksKey);
        const shelfIndexesRaw = localStorage.getItem(shelfIndexesKey);
        const rawBooks = readJson(rawBooksRaw);
        const shelfIndexes = readJson(shelfIndexesRaw);
        const cacheFound = Array.isArray(rawBooks);

        if (cacheFound || Date.now() >= deadline) {
          resolve({
            cacheFound,
            rawBooks: Array.isArray(rawBooks) ? rawBooks : [],
            shelfIndexes: Array.isArray(shelfIndexes) ? shelfIndexes : [],
          });
          return;
        }

        setTimeout(poll, 100);
      };

      poll();
    }))
  `);

  if (!result || typeof result !== 'object') {
    return { cacheFound: false, rawBooks: [], shelfIndexes: [] };
  }

  const snapshot = result as Partial<WebShelfSnapshot>;
  return {
    cacheFound: snapshot.cacheFound === true,
    rawBooks: Array.isArray(snapshot.rawBooks) ? snapshot.rawBooks : [],
    shelfIndexes: Array.isArray(snapshot.shelfIndexes) ? snapshot.shelfIndexes : [],
  };
}

cli({
  site: 'weread',
  name: 'shelf',
  description: 'List books on your WeRead bookshelf',
  domain: 'weread.qq.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Max results' },
  ],
  columns: ['title', 'author', 'progress', 'bookId'],
  func: async (page: IPage, args) => {
    const limit = normalizeShelfLimit(Number(args.limit));
    if (limit <= 0) return [];

    try {
      const data = await fetchPrivateApi(page, '/shelf/sync', { synckey: '0', lectureSynckey: '0' });
      return normalizePrivateApiRows(data, limit);
    } catch (error) {
      if (!(error instanceof CliError) || error.code !== 'AUTH_REQUIRED') {
        throw error;
      }

      const snapshot = await loadWebShelfSnapshot(page);
      if (!snapshot.cacheFound) {
        throw error;
      }
      return normalizeWebShelfRows(snapshot, limit);
    }
  },
});
