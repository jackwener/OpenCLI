import { ArgumentError } from '@jackwener/opencli/errors';
import { cleanText } from './utils.js';

const CHANNEL_OPTIONS = [
    { value: 'boy', aliases: ['boy', 'male', '男生', '男生榜'] },
    { value: 'girl', aliases: ['girl', 'female', '女生', '女生榜'] },
];

const RANK_OPTIONS = [
    { value: 'hot', aliases: ['hot', '大热榜'] },
    { value: 'new', aliases: ['new', '新书榜'] },
    { value: 'over', aliases: ['over', '完结榜'] },
    { value: 'collect', aliases: ['collect', '收藏榜'] },
    { value: 'update', aliases: ['update', '更新榜'] },
];

const DATE_OPTIONS = [
    { value: 'date', aliases: ['date', 'daily', '日榜'] },
    { value: 'month', aliases: ['month', 'monthly', '月榜'] },
];

export function getRankChoiceOptions() {
    return {
        channel: CHANNEL_OPTIONS,
        type: RANK_OPTIONS,
        period: DATE_OPTIONS,
    };
}

export function normalizeRankOptionRows() {
    const rows = [];
    for (const item of CHANNEL_OPTIONS) {
        rows.push({ group: 'channel', label: item.aliases[item.aliases.length - 1], value: item.value });
    }
    for (const item of RANK_OPTIONS) {
        rows.push({ group: 'type', label: item.aliases[item.aliases.length - 1], value: item.value });
    }
    for (const item of DATE_OPTIONS) {
        rows.push({ group: 'period', label: item.aliases[item.aliases.length - 1], value: item.value });
    }
    return rows;
}

export function resolveRankChoice(rawValue, options, defaultValue, label) {
    const value = cleanText(rawValue ?? defaultValue).toLowerCase();
    const matched = options.find((option) => option.aliases.some((alias) => cleanText(alias).toLowerCase() === value));
    if (!matched) {
        throw new ArgumentError(`qimao ${label} must be one of: ${options.map((item) => item.aliases[0]).join(', ')}`);
    }
    return matched.value;
}
