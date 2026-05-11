// npm downloads — fetch download counts for a single npm package over a window.
//
// Hits `api.npmjs.org/downloads/range/<period>/<pkg>`. Default window is the
// last 7 days (one row per day). Use `--period last-month` for 30 days, or
// pass a custom `YYYY-MM-DD:YYYY-MM-DD` range.
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';
import { NPM_API, npmFetch, requirePackageName } from './utils.js';

const FIXED_PERIODS = new Set(['last-day', 'last-week', 'last-month', 'last-year']);
const RANGE_PATTERN = /^(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/;

function requirePeriod(value) {
    const s = String(value ?? 'last-week').trim();
    if (FIXED_PERIODS.has(s)) return s;
    const m = RANGE_PATTERN.exec(s);
    if (m) {
        const [, start, end] = m;
        if (new Date(start) > new Date(end)) {
            throw new ArgumentError(`npm downloads period start ${start} is after end ${end}`);
        }
        return `${start}:${end}`;
    }
    throw new ArgumentError(
        `npm downloads period "${value}" is invalid`,
        'Use last-day / last-week (default) / last-month / last-year, or YYYY-MM-DD:YYYY-MM-DD.',
    );
}

cli({
    site: 'npm',
    name: 'downloads',
    access: 'read',
    description: 'Daily download counts for an npm package over a window',
    domain: 'api.npmjs.org',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'name', positional: true, required: true, help: 'npm package name (e.g. "react", "@vercel/og")' },
        { name: 'period', default: 'last-week', help: 'last-day / last-week / last-month / last-year, or YYYY-MM-DD:YYYY-MM-DD' },
    ],
    columns: ['rank', 'package', 'day', 'downloads'],
    func: async (args) => {
        const name = requirePackageName(args.name);
        const period = requirePeriod(args.period);
        const url = `${NPM_API}/downloads/range/${period}/${name}`;
        const body = await npmFetch(url, `npm downloads ${name}`);
        const days = Array.isArray(body?.downloads) ? body.downloads : [];
        if (!days.length) {
            throw new EmptyResultError('npm downloads', `npm has no download stats for "${name}" in window ${period}.`);
        }
        return days.map((row, i) => ({
            rank: i + 1,
            package: String(body.package ?? name),
            day: String(row.day ?? ''),
            downloads: row.downloads != null ? Number(row.downloads) : null,
        }));
    },
});
