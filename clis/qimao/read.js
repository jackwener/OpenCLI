import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    QIMAO_DOMAIN,
    buildBookUrl,
    buildChapterListApiUrl,
    buildChapterUrl,
    cleanText,
    normalizeCatalogChapter,
    parseBookId,
    parseChapterId,
    qimaoFetchJson,
    requirePositiveInt,
} from './utils.js';

function selectTargetChapter(bookId, chapters, args) {
    const chapterIdArg = args['chapter-id'];
    const chapterIndexArg = args['chapter-index'];
    if (chapterIdArg !== undefined && chapterIndexArg !== undefined) {
        throw new ArgumentError('Use either --chapter-id or --chapter-index, not both.');
    }
    if (chapterIdArg !== undefined) {
        const chapterId = parseChapterId(chapterIdArg);
        const found = chapters.find((chapter) => chapter.chapter_id === chapterId);
        if (!found) {
            throw new EmptyResultError('qimao read', `Chapter ${chapterId} was not found for book ${bookId}.`);
        }
        return found;
    }
    if (chapterIndexArg !== undefined) {
        const chapterIndex = requirePositiveInt(chapterIndexArg, 1, 'chapter-index');
        const found = chapters.find((chapter) => chapter.index === chapterIndex);
        if (!found) {
            throw new EmptyResultError('qimao read', `Chapter index ${chapterIndex} was not found for book ${bookId}.`);
        }
        return found;
    }
    if (!chapters[0]) {
        throw new EmptyResultError('qimao read', `No chapters found for book ${bookId}.`);
    }
    return chapters[0];
}

function normalizeContent(value) {
    return String(value ?? '')
        .replace(/\r/g, '')
        .split('\n')
        .map((line) => cleanText(line))
        .filter(Boolean)
        .join('\n');
}

export function normalizeReadSnapshot(snapshot, chapter) {
    const content = normalizeContent(snapshot?.content);
    if (!content) {
        throw new EmptyResultError('qimao read', `Chapter content is empty for ${chapter.chapter_id}.`);
    }
    return {
        book_id: cleanText(snapshot?.book_id) || '',
        book_title: cleanText(snapshot?.book_title),
        author: cleanText(snapshot?.author),
        chapter_id: cleanText(snapshot?.chapter_id) || chapter.chapter_id,
        index: chapter.index,
        chapter_title: cleanText(snapshot?.chapter_title) || chapter.title,
        words: Number.parseInt(String(snapshot?.words ?? ''), 10) || chapter.words,
        updated_at: cleanText(snapshot?.updated_at) || chapter.updated_at,
        url: cleanText(snapshot?.url) || chapter.url,
        content,
    };
}

async function extractReadSnapshot(page, attempts = 5) {
    let lastSnapshot = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        lastSnapshot = await page.evaluate(`
      (() => {
        const clean = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
        const pathname = window.location.pathname || '';
        const pathMatch = pathname.match(/^\\/shuku\\/(\\d+)-(\\d+)\\/?$/);
        const reader = (window.__NUXT__ && window.__NUXT__.state && window.__NUXT__.state.reader && window.__NUXT__.state.reader.readerChapterInfo) || {};
        const chapterInfo = reader.chapterInfo || {};
        const bookSummary = reader.bookSummary || {};
        const rawHtml = String(reader.chapterData || '');
        const nuxtContainer = document.createElement('div');
        nuxtContainer.innerHTML = rawHtml;
        const nuxtParagraphs = Array.from(nuxtContainer.querySelectorAll('p'))
          .map((node) => clean(node.textContent))
          .filter(Boolean);
        const domParagraphs = Array.from(document.querySelectorAll('h2 ~ p, article p, main p, [class*="chapter"] p, [class*="content"] p, [class*="read"] p'))
          .map((node) => clean(node.textContent))
          .filter(Boolean);
        const content = nuxtParagraphs.length > 0
          ? nuxtParagraphs.join('\\n\\n')
          : domParagraphs.length > 0
            ? domParagraphs.join('\\n\\n')
            : clean(
              document.querySelector('article, main, [class*="chapter"], [class*="content"], [class*="read"]')?.textContent ||
              ''
            );
        const chapterTitle = clean(chapterInfo.title || document.querySelector('h2')?.textContent || '');
        const titlePrefix = clean(document.title.replace(/最新章节[\\s\\S]*$/, ''));
        const authorFromTitle = titlePrefix.startsWith(chapterTitle)
          ? clean(titlePrefix.slice(chapterTitle.length))
          : '';
        const rawBookTitle = clean(bookSummary.book_title || chapterInfo.book_title || document.querySelector('h1')?.textContent || '');
        return {
          book_id: clean(bookSummary.book_id || chapterInfo.book_id || pathMatch?.[1] || ''),
          book_title: rawBookTitle.replace(/\\s+(完结|连载)$/, ''),
          author: clean(bookSummary.author || chapterInfo.author || document.querySelector('a[href*="/zuozhe/"]')?.textContent || authorFromTitle),
          chapter_id: clean(chapterInfo.chapter_id || pathMatch?.[2] || ''),
          chapter_title: chapterTitle,
          words: clean(chapterInfo.words || ''),
          updated_at: clean(chapterInfo.update_time || ''),
          url: clean(window.location.href || ''),
          content,
        };
      })()
    `);
        if (normalizeContent(lastSnapshot?.content)) {
            return lastSnapshot;
        }
        if (attempt < attempts - 1) {
            await page.wait({ time: 1 });
        }
    }
    return lastSnapshot;
}

async function extractBookTitleFallback(page, bookId) {
    if (!page?.evaluate) {
        return '';
    }
    try {
        return cleanText(await page.evaluate(`(async () => {
          const response = await fetch(${JSON.stringify(buildBookUrl(bookId))}, {
            headers: { accept: 'text/html' },
            credentials: 'omit',
          });
          const html = await response.text();
          const doc = new DOMParser().parseFromString(html, 'text/html');
          const title = String(
            doc.querySelector('h1')?.textContent ||
            doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
            doc.title ||
            ''
          )
            .replace(/免费阅读[\\s\\S]*$/, '')
            .replace(/最新章节[\\s\\S]*$/, '');
          return title.replace(/\\s+(完结|连载)$/, '').trim();
        })()`));
    }
    catch {
        return '';
    }
}

cli({
    site: 'qimao',
    name: 'read',
    access: 'read',
    description: 'Read a Qimao chapter by chapter id or chapter index',
    domain: QIMAO_DOMAIN,
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'book', positional: true, required: true, help: 'Qimao book id or book URL' },
        { name: 'chapter-id', help: 'Specific Qimao chapter id or chapter URL' },
        { name: 'chapter-index', type: 'int', help: '1-based chapter index from the catalog' },
    ],
    columns: [
        'book_id',
        'book_title',
        'author',
        'chapter_id',
        'index',
        'chapter_title',
        'words',
        'updated_at',
        'url',
        'content',
    ],
    func: async (page, args) => {
        const bookId = parseBookId(args.book);
        const data = await qimaoFetchJson(
            buildChapterListApiUrl(bookId),
            `qimao catalog ${bookId}`,
            buildBookUrl(bookId),
            page,
        );
        const chapters = (Array.isArray(data.chapters) ? data.chapters : [])
            .map((chapter) => normalizeCatalogChapter(bookId, chapter));
        const target = selectTargetChapter(bookId, chapters, args);
        await page.goto(target.url || buildChapterUrl(bookId, target.chapter_id), { waitUntil: 'load', settleMs: 2000 });
        await page.wait({ time: 1 });
        const snapshot = await extractReadSnapshot(page);
        if (!cleanText(snapshot?.book_title)) {
            snapshot.book_title = await extractBookTitleFallback(page, bookId);
        }
        return [normalizeReadSnapshot(snapshot, target)];
    },
});

export const __test__ = {
    normalizeReadSnapshot,
};
