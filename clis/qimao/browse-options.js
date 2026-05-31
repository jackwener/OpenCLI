import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { QIMAO_DOMAIN, QIMAO_ORIGIN, cleanText } from './utils.js';
import { fetchBrowseMetadata, normalizeBrowseOptionRows } from './browse.shared.js';

const GROUP_ALIASES = {
    channel: ['channel', '频道'],
    words: ['words', '字数', '作品字数'],
    'updated-within': ['updated-within', 'update-time', '更新时间'],
    status: ['status', 'is-over', '完结', '是否完结'],
    sort: ['sort', 'order', '排序'],
    category1: ['category1', '一级分类', '大类'],
    category2: ['category2', '二级分类', '子分类', '小类'],
    category: ['category', '分类'],
};

function normalizeGroup(value) {
    const text = cleanText(value).toLowerCase();
    if (!text) {
        return '';
    }
    for (const [group, aliases] of Object.entries(GROUP_ALIASES)) {
        if (aliases.some((alias) => cleanText(alias).toLowerCase() === text)) {
            return group;
        }
    }
    throw new ArgumentError(`qimao group must be one of: ${Object.keys(GROUP_ALIASES).join(', ')}`);
}

cli({
    site: 'qimao',
    name: 'browse-options',
    access: 'read',
    description: 'List Qimao browse filter options for programmatic use',
    domain: QIMAO_DOMAIN,
    strategy: Strategy.PUBLIC,
    browser: true,
    navigateBefore: `${QIMAO_ORIGIN}/shuku/a-a-a-a-a-a-a-click-1/`,
    args: [
        { name: 'group', help: 'Optional group: channel, words, updated-within, status, sort, category1, category2, category' },
    ],
    columns: ['group', 'label', 'value', 'parent_label', 'parent_value'],
    func: async (page, args) => {
        const rows = normalizeBrowseOptionRows(await fetchBrowseMetadata(page));
        const group = normalizeGroup(args.group);
        const filtered = group === ''
            ? rows
            : group === 'category'
                ? rows.filter((row) => row.group === 'category1' || row.group === 'category2')
                : rows.filter((row) => row.group === group);

        if (filtered.length === 0) {
            throw new EmptyResultError('qimao browse-options', 'No options found for the selected group.');
        }
        return filtered;
    },
});
