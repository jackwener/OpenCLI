import { cli, Strategy } from '@jackwener/opencli/registry';
import {
    callGateway,
    emptyResult,
    formatDate,
    formatDuration,
    formatRating,
    makeDeepLink,
    requireBookId,
    truncate,
} from './utils.js';

/**
 * 3-in-1 book lookup: `/book/info` always runs; `/book/chapterinfo` and
 * `/book/getprogress` are opt-out via `--no-chapters` / `--no-progress`
 * so users can shave 1-2 gateway calls when only a single section is needed.
 *
 * Output is a flat row list with a `section` column so table/json/yaml
 * consumers can filter without ad-hoc joins:
 *   - section=info       — single row, basic metadata
 *   - section=chapter    — one row per chapter (level/title/wordCount)
 *   - section=progress   — single row, progress % + cumulative read time
 */
cli({
    site: 'weread-official',
    name: 'book',
    access: 'read',
    description: 'Show WeRead book metadata, chapters, and reading progress',
    domain: 'weread.qq.com',
    strategy: Strategy.PUBLIC,
    browser: false,
    args: [
        { name: 'bookId', positional: true, required: true, help: 'WeRead bookId (from `weread-official search`)' },
        { name: 'no-chapters', type: 'boolean', default: false, help: 'Skip /book/chapterinfo call' },
        { name: 'no-progress', type: 'boolean', default: false, help: 'Skip /book/getprogress call' },
    ],
    columns: ['section', 'idx', 'key', 'value', 'link'],
    func: async (args) => {
        const bookId = requireBookId(args.bookId);

        const tasks = [callGateway('/book/info', { bookId })];
        const want = {
            chapters: !args['no-chapters'],
            progress: !args['no-progress'],
        };
        if (want.chapters) tasks.push(callGateway('/book/chapterinfo', { bookId }));
        if (want.progress) tasks.push(callGateway('/book/getprogress', { bookId }));

        const results = await Promise.all(tasks);
        let cursor = 0;
        const info = results[cursor++];
        const chapters = want.chapters ? results[cursor++] : null;
        const progress = want.progress ? results[cursor++] : null;

        const rows = [];

        // ── info section ────────────────────────────────────────────────────
        const infoPairs = [
            ['bookId', String(info?.bookId ?? bookId)],
            ['title', String(info?.title ?? '')],
            ['author', String(info?.author ?? '')],
            ['translator', String(info?.translator ?? '')],
            ['category', String(info?.category ?? '')],
            ['publisher', String(info?.publisher ?? '')],
            ['publishTime', String(info?.publishTime ?? '')],
            ['isbn', String(info?.isbn ?? '')],
            ['wordCount', String(info?.wordCount ?? '')],
            ['rating', formatRating(info?.newRating)],
            ['ratingCount', String(info?.newRatingCount ?? '')],
            ['intro', truncate(info?.intro, 400)],
            ['cover', String(info?.cover ?? '')],
        ];
        for (let i = 0; i < infoPairs.length; i += 1) {
            const [key, value] = infoPairs[i];
            rows.push({ section: 'info', idx: i + 1, key, value, link: '' });
        }
        rows.push({
            section: 'info',
            idx: infoPairs.length + 1,
            key: 'link',
            value: '',
            link: makeDeepLink({ bookId }),
        });

        // ── chapters section ────────────────────────────────────────────────
        if (chapters) {
            const list = Array.isArray(chapters?.chapters) ? chapters.chapters : [];
            list.forEach((ch, i) => {
                const chapterUid = String(ch?.chapterUid ?? '').trim();
                const level = Number(ch?.level ?? 1);
                const indent = '  '.repeat(Math.max(0, level - 1));
                const title = `${indent}${String(ch?.title ?? '')}`;
                const wordCount = Number(ch?.wordCount ?? 0);
                const paid = Number(ch?.paid ?? 0) === 1;
                const price = Number(ch?.price ?? 0);
                const meta = [`${wordCount}字`];
                if (price > 0) meta.push(paid ? '已购买' : `${price}元`);
                rows.push({
                    section: 'chapter',
                    idx: Number(ch?.chapterIdx ?? i + 1),
                    key: chapterUid,
                    value: `${title}  (${meta.join(' · ')})`,
                    link: chapterUid ? makeDeepLink({ bookId, chapterUid }) : '',
                });
            });
        }

        // ── progress section ────────────────────────────────────────────────
        if (progress) {
            const p = progress?.book ?? {};
            const pct = Number(p?.progress ?? 0);
            const updateTime = formatDate(p?.updateTime);
            const finishTime = pct === 100 ? formatDate(p?.finishTime) : '';
            const cumulative = formatDuration(p?.recordReadingTime);
            const isStart = Number(p?.isStartReading ?? 0) === 1;
            const progressPairs = [
                ['progress', `${pct}%`],
                ['cumulative', cumulative],
                ['lastReadAt', updateTime],
                ['finishedAt', finishTime],
                ['isStartReading', isStart ? 'true' : 'false'],
                ['currentChapterUid', String(p?.chapterUid ?? '')],
            ];
            for (let i = 0; i < progressPairs.length; i += 1) {
                const [key, value] = progressPairs[i];
                rows.push({ section: 'progress', idx: i + 1, key, value, link: '' });
            }
        }

        if (rows.length === 0) {
            emptyResult('book', `No data returned for bookId=${bookId}`);
        }
        return rows;
    },
});
