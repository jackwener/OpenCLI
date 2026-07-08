// homebrew popular — list the most-installed Homebrew formulae or casks.
//
// Hits `https://formulae.brew.sh/api/analytics/(install|cask-install)/<window>.json`.
// Anonymous-aggregated install counts published by Homebrew themselves;
// rows round-trip into `homebrew formula` / `homebrew cask` via the `token`
// column. The 30/90/365-day windows are the only ones the analytics endpoint
// publishes — anything else 404s upstream.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { EmptyResultError } from '@jackwener/opencli/errors';
import { BREW_BASE, brewFetch, parseInstallCount, requireBoundedInt, requireOneOf } from './utils.js';

const TYPES = ['formula', 'cask'];
const WINDOWS = ['30d', '90d', '365d'];

cli({
    site: 'homebrew',
    name: 'popular',
    access: 'read',
    description: 'List most-installed Homebrew formulae or casks (Homebrew\'s analytics ranking)',
    domain: 'formulae.brew.sh',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'type', default: 'formula', help: `Package type (${TYPES.join(' / ')})` },
        { name: 'window', default: '30d', help: `Time window (${WINDOWS.join(' / ')})` },
        { name: 'limit', type: 'int', default: 30, help: 'Max rows (1-500)' },
    ],
    columns: ['rank', 'token', 'type', 'installs', 'percent', 'window', 'url'],
    func: async (args) => {
        const type = requireOneOf(args.type, TYPES, 'type');
        const window = requireOneOf(args.window, WINDOWS, 'window');
        const limit = requireBoundedInt(args.limit, 30, 500);
        const path = type === 'cask' ? 'cask-install' : 'install';
        const url = `${BREW_BASE}/analytics/${path}/${window}.json`;
        const body = await brewFetch(url, 'homebrew popular');
        const items = Array.isArray(body?.items) ? body.items : [];
        if (!items.length) {
            throw new EmptyResultError('homebrew popular', `Homebrew analytics returned no items for ${type}/${window}.`);
        }
        return items.slice(0, limit).map((row, i) => {
            const token = String(type === 'cask' ? row.cask : row.formula ?? '').trim();
            const detailPath = type === 'cask' ? 'cask' : 'formula';
            return {
                rank: row.number != null ? Number(row.number) : i + 1,
                token,
                type,
                installs: parseInstallCount(row.count),
                percent: row.percent != null ? Number(row.percent) : null,
                window,
                url: token ? `https://formulae.brew.sh/${detailPath}/${encodeURIComponent(token)}` : '',
            };
        });
    },
});
