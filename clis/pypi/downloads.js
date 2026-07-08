// pypi downloads — fetch download counts for a single PyPI package via
// pypistats.org's public JSON API.
//
// Default endpoint is `/api/packages/<pkg>/recent` which returns last-day /
// last-week / last-month totals as a single row. Pass `--period overall` to
// hit `/api/packages/<pkg>/overall` for the full daily history (one row per
// day).
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { PYPISTATS_BASE, pypiFetch, requirePackageName } from './utils.js';

const PERIODS = new Set(['recent', 'overall']);

function requirePeriod(value) {
    const s = String(value ?? 'recent').trim().toLowerCase();
    if (!PERIODS.has(s)) {
        throw new ArgumentError(
            `pypi downloads period "${value}" is invalid`,
            'Allowed values: recent (default — last day/week/month totals) or overall (full daily history).',
        );
    }
    return s;
}

cli({
    site: 'pypi',
    name: 'downloads',
    access: 'read',
    description: 'PyPI download stats for a package (recent totals or full daily history)',
    domain: 'pypistats.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'name', positional: true, required: true, help: 'PyPI package name (e.g. "requests", "pandas")' },
        { name: 'period', default: 'recent', help: 'recent (default — 1 row, last day/week/month) or overall (1 row per day)' },
    ],
    columns: ['rank', 'package', 'period', 'date', 'downloads'],
    func: async (args) => {
        const name = requirePackageName(args.name);
        const period = requirePeriod(args.period);
        if (period === 'recent') {
            const body = await pypiFetch(`${PYPISTATS_BASE}/api/packages/${encodeURIComponent(name)}/recent`, `pypi downloads ${name}`);
            const data = body?.data;
            if (!data || (data.last_day == null && data.last_week == null && data.last_month == null)) {
                throw new EmptyResultError('pypi downloads', `pypistats has no recent download data for "${name}".`);
            }
            return [
                { rank: 1, package: String(body.package ?? name), period: 'last_day', date: '', downloads: data.last_day != null ? Number(data.last_day) : null },
                { rank: 2, package: String(body.package ?? name), period: 'last_week', date: '', downloads: data.last_week != null ? Number(data.last_week) : null },
                { rank: 3, package: String(body.package ?? name), period: 'last_month', date: '', downloads: data.last_month != null ? Number(data.last_month) : null },
            ];
        }
        const body = await pypiFetch(`${PYPISTATS_BASE}/api/packages/${encodeURIComponent(name)}/overall?mirrors=false`, `pypi downloads ${name}`);
        const days = Array.isArray(body?.data) ? body.data : [];
        if (!days.length) {
            throw new EmptyResultError('pypi downloads', `pypistats has no overall download history for "${name}".`);
        }
        return days.map((row, i) => ({
            rank: i + 1,
            package: String(body.package ?? name),
            period: 'daily',
            date: String(row.date ?? ''),
            downloads: row.downloads != null ? Number(row.downloads) : null,
        }));
    },
});
