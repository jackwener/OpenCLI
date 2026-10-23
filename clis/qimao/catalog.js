import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    QIMAO_ORIGIN,
    QIMAO_DOMAIN,
    buildBookUrl,
    buildChapterListApiUrl,
    normalizeCatalogChapter,
    parseBookId,
    qimaoFetchJson,
    requireLimit,
    requireNonNegativeInt,
} from './utils.js';

cli({
    site: 'qimao',
    name: 'catalog',
    access: 'read',
    description: 'List Qimao chapters for a book',
    domain: QIMAO_DOMAIN,
    strategy: Strategy.PUBLIC,
    browser: true,
    navigateBefore: QIMAO_ORIGIN,
    args: [
        { name: 'book', positional: true, required: true, help: 'Qimao book id or book URL' },
        { name: 'limit', type: 'int', default: 50, help: 'Max chapters to return (1-500)' },
        { name: 'offset', type: 'int', default: 0, help: 'Zero-based chapter offset' },
    ],
    columns: ['index', 'chapter_id', 'title', 'words', 'is_vip', 'updated_at', 'url'],
    func: async (page, args) => {
        const bookId = parseBookId(args.book);
        const limit = requireLimit(args.limit, 50, 500);
        const offset = requireNonNegativeInt(args.offset, 0, 'offset');
        const data = await qimaoFetchJson(
            buildChapterListApiUrl(bookId),
            `qimao catalog ${bookId}`,
            buildBookUrl(bookId),
            page,
        );
        const chapters = Array.isArray(data.chapters) ? data.chapters : [];
        if (chapters.length === 0) {
            throw new EmptyResultError('qimao catalog', `No chapters found for book ${bookId}.`);
        }
        return chapters
            .slice(offset, offset + limit)
            .map((chapter) => normalizeCatalogChapter(bookId, chapter));
    },
});
