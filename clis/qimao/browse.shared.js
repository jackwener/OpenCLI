import { ArgumentError } from '@jackwener/opencli/errors';
import { QIMAO_ORIGIN, buildClassifySelectOptionApiUrl, cleanText, qimaoFetchJson } from './utils.js';

function normalizeAlias(value) {
    return cleanText(value).toLowerCase();
}

function parseBrowseUrl(rawValue) {
    if (!/^https?:\/\//i.test(rawValue)) {
        return null;
    }
    let parsed;
    try {
        parsed = new URL(rawValue);
    }
    catch {
        return null;
    }
    const matched = parsed.pathname.match(/^\/shuku\/([^/]+)\/?$/);
    if (!matched?.[1]) {
        return null;
    }
    const parts = matched[1].split('-');
    if (parts.length < 9) {
        return null;
    }
    return {
        channel: parts[1] || 'a',
        category1: parts[2] || 'a',
        category2: parts[3] || 'a',
        words: parts[4] || 'a',
        updateTime: parts[5] || 'a',
        isVip: parts[6] || 'a',
        isOver: parts[7] || 'a',
        order: parts[8] || 'click',
    };
}

export function resolveCategoryValue(rawValue, categories) {
    if (rawValue == null || normalizeAlias(rawValue) === '' || ['a', 'all', '全部'].includes(normalizeAlias(rawValue))) {
        return { category1: 'a', category2: 'a', label: '全部' };
    }

    const fromUrl = parseBrowseUrl(String(rawValue));
    if (fromUrl) {
        return {
            category1: fromUrl.category1,
            category2: fromUrl.category2,
            label: cleanText(rawValue),
        };
    }

    const normalized = normalizeAlias(rawValue);
    const parentMatches = [];
    const childMatches = [];

    for (const parent of categories) {
        if (!parent || cleanText(parent.id) === 'a') {
            continue;
        }
        if ([cleanText(parent.id), cleanText(parent.name)].some((item) => normalizeAlias(item) === normalized)) {
            parentMatches.push(parent);
        }
        for (const child of Array.isArray(parent.children) ? parent.children : []) {
            if ([cleanText(child.id), cleanText(child.name)].some((item) => normalizeAlias(item) === normalized)) {
                childMatches.push({ parent, child });
            }
        }
    }

    if (childMatches.length === 1) {
        return {
            category1: cleanText(childMatches[0].parent.id),
            category2: cleanText(childMatches[0].child.id),
            label: cleanText(childMatches[0].child.name),
        };
    }
    if (childMatches.length > 1) {
        throw new ArgumentError(`qimao category is ambiguous: ${rawValue}. Use a numeric category id instead.`);
    }
    if (parentMatches.length === 1) {
        return {
            category1: cleanText(parentMatches[0].id),
            category2: 'a',
            label: cleanText(parentMatches[0].name),
        };
    }
    throw new ArgumentError(`Unknown qimao category: ${rawValue}`);
}

export function normalizeBrowseOptionRows(metadata) {
    const rows = [];
    const pushFilterGroup = (group, list = []) => {
        for (const item of list) {
            rows.push({
                group,
                label: cleanText(item?.label),
                value: cleanText(item?.value),
                parent_label: '',
                parent_value: '',
            });
        }
    };

    const filters = metadata?.filters ?? {};
    pushFilterGroup('channel', filters.channel);
    pushFilterGroup('words', filters.words);
    pushFilterGroup('updated-within', filters.update_time);
    pushFilterGroup('status', filters.is_over);
    pushFilterGroup('sort', filters.order);

    for (const category of Array.isArray(metadata?.category) ? metadata.category : []) {
        const categoryId = cleanText(category?.id);
        const categoryName = cleanText(category?.name);
        rows.push({
            group: 'category1',
            label: categoryName,
            value: categoryId,
            parent_label: '',
            parent_value: '',
        });
        for (const child of Array.isArray(category?.children) ? category.children : []) {
            rows.push({
                group: 'category2',
                label: cleanText(child?.name),
                value: cleanText(child?.id),
                parent_label: categoryName,
                parent_value: categoryId,
            });
        }
    }
    return rows;
}

export async function fetchBrowseMetadata(page) {
    return qimaoFetchJson(
        buildClassifySelectOptionApiUrl(),
        'qimao browse options',
        `${QIMAO_ORIGIN}/shuku/a-a-a-a-a-a-a-click-1/`,
        page,
    );
}
