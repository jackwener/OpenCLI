import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import {
    QIMAO_ORIGIN,
    QIMAO_DOMAIN,
    buildClassifyBookListApiUrl,
    cleanText,
    qimaoFetchJson,
    requireLimit,
    requirePositiveInt,
    stripHtml,
} from './utils.js';
import { fetchBrowseMetadata, normalizeBrowseOptionRows, resolveCategoryValue } from './browse.shared.js';

const PAGE_SIZE = 15;

const FILTER_OPTIONS = {
    channel: [
        { value: 'a', aliases: ['a', 'all', '全部'] },
        { value: '1', aliases: ['1', 'female', 'women', 'girl', '女生', '女生原创'] },
        { value: '0', aliases: ['0', 'male', 'men', 'boy', '男生', '男生原创'] },
        { value: '2', aliases: ['2', 'publish', 'published', 'book', '出版', '出版图书'] },
    ],
    words: [
        { value: 'a', aliases: ['a', 'all', '全部'] },
        { value: '1', aliases: ['1', 'lt30w', 'under-300k', '30万以下'] },
        { value: '2', aliases: ['2', '30to50w', '30万-50万'] },
        { value: '3', aliases: ['3', '50to100w', '50万-100万'] },
        { value: '4', aliases: ['4', '100to200w', '100万-200万'] },
        { value: '5', aliases: ['5', 'gt200w', 'over-200w', '200万以上'] },
    ],
    update_time: [
        { value: 'a', aliases: ['a', 'all', '全部'] },
        { value: '1', aliases: ['1', '3d', '3days', '3天内'] },
        { value: '2', aliases: ['2', '7d', '7days', '7天内'] },
        { value: '3', aliases: ['3', '30d', '30days', '30天内'] },
    ],
    is_over: [
        { value: 'a', aliases: ['a', 'all', '全部'] },
        { value: '1', aliases: ['1', 'finished', 'completed', '已完结', '完结'] },
        { value: '0', aliases: ['0', 'serial', 'ongoing', '连载中'] },
    ],
    order: [
        { value: 'click', aliases: ['click', '按点击量'] },
        { value: 'words_num', aliases: ['words_num', 'words', '按总字数'] },
        { value: 'update_time', aliases: ['update_time', 'update', 'recent', '最近更新'] },
        { value: 'favorite_uv', aliases: ['favorite_uv', 'favorite', 'favorites', '按收藏数'] },
    ],
};

function normalizeAlias(value) {
    return cleanText(value).toLowerCase();
}

function resolveFilterValue(rawValue, label, options, defaultValue) {
    if (rawValue == null) {
        return defaultValue;
    }
    const normalized = normalizeAlias(rawValue);
    const matched = options.find((option) => option.aliases.some((alias) => normalizeAlias(alias) === normalized));
    if (!matched) {
        throw new ArgumentError(`qimao ${label} must be one of: ${options.map((item) => item.aliases[0]).join(', ')}`);
    }
    return matched.value;
}

export function normalizeBrowseRow(item, rank) {
    return {
        rank,
        book_id: cleanText(item?.book_id),
        title: cleanText(item?.title),
        author: cleanText(item?.author),
        category: cleanText(item?.category2_name),
        status: cleanText(item?.is_over_txt),
        words: cleanText(item?.words_num),
        latest_chapter: cleanText(item?.latest_chapter_title),
        updated_at: cleanText(item?.update_time_txt || item?.update_time),
        url: cleanText(item?.read_url),
        category_url: cleanText(item?.category_url),
        intro: stripHtml(item?.intro),
    };
}

cli({
    site: 'qimao',
    name: 'browse',
    access: 'read',
    description: 'Browse Qimao category listings with filters and sorting',
    domain: QIMAO_DOMAIN,
    strategy: Strategy.PUBLIC,
    browser: true,
    navigateBefore: `${QIMAO_ORIGIN}/shuku/a-a-a-a-a-a-a-click-1/`,
    args: [
        { name: 'category', help: 'Category name/id, subcategory name/id, or a Qimao classify URL' },
        { name: 'channel', help: 'all, female, male, publish' },
        { name: 'words', help: 'all, lt30w, 30to50w, 50to100w, 100to200w, gt200w' },
        { name: 'updated-within', help: 'all, 3d, 7d, 30d' },
        { name: 'status', help: 'all, finished, serial' },
        { name: 'sort', help: 'click, words, update, favorite' },
        { name: 'page', type: 'int', default: 1, help: 'Starting page number (1-based)' },
        { name: 'limit', type: 'int', default: 15, help: 'Max rows to return across pages (1-50)' },
    ],
    columns: [
        'rank',
        'book_id',
        'title',
        'author',
        'category',
        'status',
        'words',
        'latest_chapter',
        'updated_at',
        'url',
        'intro',
    ],
    func: async (page, args) => {
        const startPage = requirePositiveInt(args.page, 1, 'page');
        const limit = requireLimit(args.limit, 15, 50);
        const metadata = await fetchBrowseMetadata(page);
        const categoryOptions = Array.isArray(metadata.category) ? metadata.category : [];
        const category = resolveCategoryValue(args.category, categoryOptions);
        const channel = resolveFilterValue(args.channel, 'channel', FILTER_OPTIONS.channel, 'a');
        const words = resolveFilterValue(args.words, 'words', FILTER_OPTIONS.words, 'a');
        const updateTime = resolveFilterValue(args['updated-within'], 'updated-within', FILTER_OPTIONS.update_time, 'a');
        const isOver = resolveFilterValue(args.status, 'status', FILTER_OPTIONS.is_over, 'a');
        const order = resolveFilterValue(args.sort, 'sort', FILTER_OPTIONS.order, 'click');

        const rows = [];
        const pagesToFetch = Math.ceil(limit / PAGE_SIZE);

        for (let offset = 0; offset < pagesToFetch; offset += 1) {
            const currentPage = startPage + offset;
            const data = await qimaoFetchJson(
                buildClassifyBookListApiUrl({
                    channel,
                    category1: category.category1,
                    category2: category.category2,
                    words,
                    updateTime,
                    isVip: 'a',
                    isOver,
                    order,
                    page: currentPage,
                }),
                `qimao browse page ${currentPage}`,
                `${QIMAO_ORIGIN}/shuku/a-a-a-a-a-a-a-click-1/`,
                page,
            );

            const list = Array.isArray(data.book_list) ? data.book_list : [];
            if (list.length === 0) {
                break;
            }
            for (const item of list) {
                rows.push(normalizeBrowseRow(item, rows.length + 1));
                if (rows.length >= limit) {
                    break;
                }
            }
            if (rows.length >= limit || list.length < PAGE_SIZE) {
                break;
            }
        }

        if (rows.length === 0) {
            throw new EmptyResultError('qimao browse', 'Qimao returned no books for the selected filters.');
        }
        return rows;
    },
});

export const __test__ = {
    normalizeBrowseRow,
    normalizeBrowseOptionRows,
    resolveCategoryValue,
};
