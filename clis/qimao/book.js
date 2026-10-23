import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    QIMAO_DOMAIN,
    buildBookUrl,
    cleanText,
    normalizeStatus,
    parseBookId,
} from './utils.js';

export function normalizeBookSnapshot(snapshot, bookId) {
    const title = cleanText(snapshot?.title);
    if (!title) {
        throw new EmptyResultError('qimao book', `No book detail found for book ${bookId}.`);
    }
    return {
        book_id: bookId,
        title,
        author: cleanText(snapshot?.author),
        category: cleanText(snapshot?.category),
        status: normalizeStatus(snapshot?.status),
        score: cleanText(snapshot?.score),
        words: cleanText(snapshot?.words),
        chapters: Number.parseInt(String(snapshot?.chapters ?? ''), 10) || null,
        characters: cleanText(snapshot?.characters),
        latest_chapter: cleanText(snapshot?.latest_chapter),
        updated_at: cleanText(snapshot?.updated_at),
        intro: cleanText(snapshot?.intro),
        cover: cleanText(snapshot?.cover),
        url: cleanText(snapshot?.url) || buildBookUrl(bookId),
    };
}

async function extractBookSnapshot(page) {
    return page.evaluate(`
      (() => {
        const clean = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
        const nuxt = window.__NUXT__ || {};
        const state = nuxt.state || {};
        const common = state.common || {};
        const related = common.bookRelatedInfo || {};
        const detail = related.bookDetail || {};
        const introData = related.bookIntroData || {};
        const authorDetail = related.authorDetail || {};
        return {
          title: clean(detail.title || document.querySelector('h1')?.textContent || ''),
          author: clean(detail.author || authorDetail.author_name || document.querySelector('a[href*="/zuozhe/"]')?.textContent || ''),
          category: clean(detail.category_2_name || ''),
          status: detail.is_over,
          score: clean(detail.score || ''),
          words: clean(detail.words_num || ''),
          chapters: clean(detail.catalogue_num || ''),
          characters: clean(detail.characters || ''),
          latest_chapter: clean(detail.latest_chapter_title || ''),
          updated_at: clean(detail.update_time || ''),
          intro: clean(introData.intro || ''),
          cover: clean(detail.image_link || document.querySelector('img')?.src || ''),
          url: clean(window.location.href || ''),
        };
      })()
    `);
}

cli({
    site: 'qimao',
    name: 'book',
    access: 'read',
    description: 'Read Qimao book details',
    domain: QIMAO_DOMAIN,
    strategy: Strategy.PUBLIC,
    browser: true,
    args: [
        { name: 'book', positional: true, required: true, help: 'Qimao book id or book URL' },
    ],
    columns: [
        'book_id',
        'title',
        'author',
        'category',
        'status',
        'score',
        'words',
        'chapters',
        'characters',
        'latest_chapter',
        'updated_at',
        'url',
        'cover',
        'intro',
    ],
    func: async (page, args) => {
        const bookId = parseBookId(args.book);
        await page.goto(buildBookUrl(bookId), { waitUntil: 'load', settleMs: 2000 });
        await page.wait({ time: 1 });
        const snapshot = await extractBookSnapshot(page);
        return [normalizeBookSnapshot(snapshot, bookId)];
    },
});

export const __test__ = {
    normalizeBookSnapshot,
};
