import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import {
    QIMAO_ORIGIN,
    QIMAO_DOMAIN,
    buildSearchApiUrl,
    cleanText,
    qimaoFetchJson,
    requireLimit,
    requirePositiveInt,
    requireString,
    stripHtml,
} from './utils.js';

cli({
    site: 'qimao',
    name: 'search',
    access: 'read',
    description: 'Search Qimao books by title, author, or character',
    domain: QIMAO_DOMAIN,
    strategy: Strategy.PUBLIC,
    browser: true,
    navigateBefore: QIMAO_ORIGIN,
    args: [
        { name: 'query', positional: true, required: true, help: 'Book title, author, or character keyword' },
        { name: 'limit', type: 'int', default: 10, help: 'Max rows to return (1-50)' },
        { name: 'page', type: 'int', default: 1, help: 'Result page number (1-based)' },
    ],
    columns: [
        'rank',
        'book_id',
        'title',
        'author',
        'category',
        'status',
        'words',
        'characters',
        'latest_chapter',
        'updated_at',
        'url',
        'intro',
    ],
    func: async (page, args) => {
        const query = requireString(args.query, 'query');
        const limit = requireLimit(args.limit, 10, 50);
        const pageNumber = requirePositiveInt(args.page, 1, 'page');
        const data = await qimaoFetchJson(
            buildSearchApiUrl(query, pageNumber, limit),
            `qimao search ${query}`,
            `${QIMAO_ORIGIN}/`,
            page,
        );
        const list = Array.isArray(data.search_list) ? data.search_list : [];
        if (list.length === 0) {
            throw new EmptyResultError('qimao search', `Qimao returned no books matching "${query}".`);
        }
        return list.slice(0, limit).map((item, index) => ({
            rank: index + 1,
            book_id: cleanText(item?.book_id),
            title: cleanText(item?.title),
            author: cleanText(item?.author),
            category: cleanText(item?.category2_name),
            status: cleanText(item?.is_over_txt),
            words: cleanText(item?.words_num),
            characters: cleanText(item?.characters),
            latest_chapter: cleanText(item?.latest_chapter_title),
            updated_at: cleanText(item?.update_time),
            url: cleanText(item?.read_url),
            intro: stripHtml(item?.intro),
        }));
    },
});
