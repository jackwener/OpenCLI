import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { QIMAO_DOMAIN, buildRankUrl, cleanText } from './utils.js';
import { normalizeRankOptionRows } from './rank.shared.js';

const GROUP_ALIASES = {
    channel: ['channel', '频道'],
    type: ['type', '榜单', '榜单类型'],
    period: ['period', '时间', '周期', '时间范围'],
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
    name: 'rank-options',
    access: 'read',
    description: 'List Qimao ranking dimensions for programmatic use',
    domain: QIMAO_DOMAIN,
    strategy: Strategy.PUBLIC,
    browser: true,
    navigateBefore: buildRankUrl(),
    args: [
        { name: 'group', help: 'Optional group: channel, type, period' },
    ],
    columns: ['group', 'label', 'value'],
    func: async (_page, args) => {
        const group = normalizeGroup(args.group);
        const rows = normalizeRankOptionRows();
        const filtered = group ? rows.filter((row) => row.group === group) : rows;
        if (filtered.length === 0) {
            throw new EmptyResultError('qimao rank-options', 'No ranking options found for the selected group.');
        }
        return filtered;
    },
});
