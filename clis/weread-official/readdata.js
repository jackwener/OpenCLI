import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    callGateway,
    emptyResult,
    formatDate,
    formatDuration,
    requireChoice,
    requirePositiveInt,
} from './utils.js';

/**
 * `/readdata/detail` — reading statistics summary.
 * Per SKILL.md every duration field is in SECONDS — `totalReadTime`,
 * `dayAverageReadTime`, `readLongest[].readTime`, `preferTime`, etc.
 * `preferAuthor[].readTime` is the one exception (already formatted by server
 * as "X小时Y分钟"); we surface it verbatim.
 *
 * Output uses a `section` column so callers can filter:
 *   - summary       — single overview row
 *   - longest       — books / albums sorted by read time
 *   - readStat      — counts (读过 / 读完 / 阅读 / 笔记)
 *   - preferCategory / preferAuthor / preferPublisher
 *   - preferTime    — 24h time distribution (starts at 6am per SKILL.md)
 */
const MODE_CHOICES = ['weekly', 'monthly', 'annually', 'overall'];

cli({
    site: 'weread-official',
    name: 'readdata',
    access: 'read',
    description: 'Reading statistics: time, streak, preferences, top books',
    domain: 'weread.qq.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'mode', default: 'monthly', choices: MODE_CHOICES, help: 'Stat window: weekly / monthly / annually / overall' },
        { name: 'base-time', type: 'int', help: 'Optional Unix timestamp inside the target period; default is current period' },
    ],
    columns: ['section', 'idx', 'key', 'value', 'detail'],
    func: async (args) => {
        const mode = requireChoice(args.mode, MODE_CHOICES, 'mode', 'monthly');
        const params = { mode };
        if (args['base-time'] !== undefined && args['base-time'] !== null && args['base-time'] !== '') {
            params.baseTime = requirePositiveInt(args['base-time'], 'base-time');
        }
        const payload = await callGateway('/readdata/detail', params);

        const rows = [];
        const totalReadTime = Number(payload?.totalReadTime ?? 0);
        const dayAverage = Number(payload?.dayAverageReadTime ?? 0);
        const readDays = Number(payload?.readDays ?? 0);
        const compareRaw = payload?.compare;
        const compare = Number.isFinite(Number(compareRaw)) ? Number(compareRaw) : null;

        const summary = [
            ['mode', mode, ''],
            ['baseTime', formatDate(payload?.baseTime), String(payload?.baseTime ?? '')],
            ['readDays', String(readDays), ''],
            ['totalReadTime', formatDuration(totalReadTime), `${totalReadTime}s`],
            ['dayAverageReadTime', formatDuration(dayAverage), `${dayAverage}s`],
            ['compareToPrev', compare === null ? '' : `${(compare * 100).toFixed(1)}%`, ''],
            ['readRate', payload?.readRate !== undefined ? `${Number(payload.readRate).toFixed(1)}%` : '', ''],
            ['preferTimeWord', String(payload?.preferTimeWord ?? ''), ''],
            ['preferCategoryWord', String(payload?.preferCategoryWord ?? ''), ''],
        ];
        for (let i = 0; i < summary.length; i += 1) {
            const [key, value, detail] = summary[i];
            rows.push({ section: 'summary', idx: i + 1, key, value, detail });
        }

        const longest = Array.isArray(payload?.readLongest) ? payload.readLongest : [];
        longest.forEach((entry, i) => {
            const book = entry?.book ?? {};
            const albumInfo = entry?.albumInfo ?? null;
            const title = albumInfo ? String(albumInfo?.name ?? '') : String(book?.title ?? '');
            const author = albumInfo ? String(albumInfo?.authorName ?? '') : String(book?.author ?? '');
            const tags = Array.isArray(entry?.tags) ? entry.tags.join(',') : '';
            const readTime = Number(entry?.readTime ?? 0);
            rows.push({
                section: 'longest',
                idx: i + 1,
                key: title,
                value: formatDuration(readTime),
                detail: `${author}${tags ? `  [${tags}]` : ''}`,
            });
        });

        const readStat = Array.isArray(payload?.readStat) ? payload.readStat : [];
        readStat.forEach((entry, i) => {
            rows.push({
                section: 'readStat',
                idx: i + 1,
                key: String(entry?.stat ?? ''),
                value: String(entry?.counts ?? ''),
                detail: '',
            });
        });

        const preferCategory = Array.isArray(payload?.preferCategory) ? payload.preferCategory : [];
        preferCategory.forEach((entry, i) => {
            const seconds = Number(entry?.readingTime ?? 0);
            rows.push({
                section: 'preferCategory',
                idx: i + 1,
                key: String(entry?.categoryTitle ?? ''),
                value: formatDuration(seconds),
                detail: `${Number(entry?.readingCount ?? 0)}本`,
            });
        });

        const preferAuthor = Array.isArray(payload?.preferAuthor) ? payload.preferAuthor : [];
        preferAuthor.forEach((entry, i) => {
            rows.push({
                section: 'preferAuthor',
                idx: i + 1,
                key: String(entry?.name ?? ''),
                // preferAuthor[].readTime is server-formatted ("5小时30分钟"), not seconds.
                value: String(entry?.readTime ?? ''),
                detail: `${Number(entry?.count ?? 0)}本`,
            });
        });

        const preferPublisher = Array.isArray(payload?.preferPublisher) ? payload.preferPublisher : [];
        preferPublisher.forEach((entry, i) => {
            rows.push({
                section: 'preferPublisher',
                idx: i + 1,
                key: String(entry?.name ?? ''),
                value: `${Number(entry?.count ?? 0)}本`,
                detail: '',
            });
        });

        const preferTime = Array.isArray(payload?.preferTime) ? payload.preferTime : [];
        if (preferTime.length === 24) {
            // SKILL.md: order starts at 06:00 and wraps to 05:00. Translate to a flat
            // (hour-of-day → duration) view so consumers do not need to know the offset.
            for (let i = 0; i < 24; i += 1) {
                const hour = (6 + i) % 24;
                const seconds = Number(preferTime[i] ?? 0);
                rows.push({
                    section: 'preferTime',
                    idx: i + 1,
                    key: `${String(hour).padStart(2, '0')}:00`,
                    value: formatDuration(seconds),
                    detail: `${seconds}s`,
                });
            }
        }

        if (rows.length === 0) {
            emptyResult('readdata', `No reading data for mode=${mode}.`);
        }
        return rows;
    },
});

export { MODE_CHOICES };
