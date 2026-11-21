import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';

const NOWCODER_HOME = 'https://www.nowcoder.com';
const RECOMMEND_URL = 'https://gw-c.nowcoder.com/api/sparta/home/recommend';
const PAGE_SIZE = 20;

function positiveInteger(value, name, maximum) {
    const text = String(value ?? '').trim();
    if (!/^[1-9]\d*$/.test(text)) {
        throw new ArgumentError(`nowcoder recommend --${name} must be a positive integer`);
    }
    const number = Number(text);
    if (!Number.isSafeInteger(number) || number > maximum) {
        throw new ArgumentError(`nowcoder recommend --${name} must be <= ${maximum}`);
    }
    return number;
}

function validateArgs(args) {
    positiveInteger(args.page ?? 1, 'page', 1000);
    positiveInteger(args.limit ?? 15, 'limit', 50);
}

function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function metric(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function recordKey(record) {
    const entityId = record?.extraInfo?.entityId;
    return typeof entityId === 'string' || typeof entityId === 'number' ? String(entityId) : '';
}

function mapRecord(record, index) {
    const moment = record?.momentData;
    const longContent = record?.longContentData;
    const content = record?.contentData;
    const promotion = record?.recommendCreativity;

    if (record?.contentType === 250 && content && typeof content === 'object') {
        return {
            rank: index + 1,
            post_type: 'content',
            id: String(content.uuid || record.contentId || ''),
            title: text(content.title) || '(untitled)',
            author: text(record.userBrief?.nickname),
            likes: metric(record.frequencyData?.likeCnt),
            comments: metric(record.frequencyData?.commentCnt),
            views: metric(record.frequencyData?.viewCnt),
            content: text(content.content),
            url: content.id ? `https://www.nowcoder.com/discuss/${content.id}` : '',
        };
    }
    if (record?.contentType === 74 && moment && typeof moment === 'object') {
        return {
            rank: index + 1,
            post_type: 'moment',
            id: String(moment.uuid || record.contentId || ''),
            title: text(moment.title) || '(untitled)',
            author: text(record.userBrief?.nickname),
            likes: metric(record.frequencyData?.likeCnt),
            comments: metric(record.frequencyData?.commentCnt),
            views: metric(record.frequencyData?.viewCnt),
            content: text(moment.content),
            url: moment.uuid ? `https://www.nowcoder.com/feed/main/detail/${moment.uuid}` : '',
        };
    }
    if (record?.contentType === 993 && promotion && typeof promotion === 'object') {
        const adId = promotion.adId ?? promotion.messageId ?? record.extraInfo?.entityId;
        return {
            rank: index + 1,
            post_type: 'promotion',
            id: adId == null || adId === '' ? '' : String(adId),
            title: text(promotion.title) || '(untitled)',
            author: text(record.userBrief?.nickname),
            likes: metric(record.frequencyData?.likeCnt),
            comments: metric(record.frequencyData?.commentCnt),
            views: metric(record.frequencyData?.viewCnt),
            content: text(promotion.content),
            url: text(promotion.linkUrl),
            company: text(promotion.companyName),
        };
    }
    if (longContent && typeof longContent === 'object') {
        return {
            rank: index + 1,
            post_type: 'content',
            id: String(longContent.uuid || record.contentId || ''),
            title: text(longContent.title) || '(untitled)',
            author: text(record.userBrief?.nickname),
            likes: metric(record.frequencyData?.likeCnt),
            comments: metric(record.frequencyData?.commentCnt),
            views: metric(record.frequencyData?.viewCnt),
            content: text(longContent.content),
            url: longContent.id ? `https://www.nowcoder.com/discuss/${longContent.id}` : '',
        };
    }
    return null;
}

async function readVisitUserId(page) {
    try {
        const value = await page.evaluate(() => {
            const gio = globalThis.gio;
            if (typeof gio !== 'function') return '';
            const ids = gio('getVisitUserId');
            return Array.isArray(ids) && typeof ids[0] === 'string' ? ids[0] : '';
        });
        return typeof value === 'string' ? value : '';
    }
    catch {
        return '';
    }
}

async function fetchPage(page, pageNumber, cursorScore, cuid, timeoutMs) {
    const url = new URL(RECOMMEND_URL);
    url.searchParams.set('page', String(pageNumber));
    url.searchParams.set('size', String(PAGE_SIZE));
    if (cursorScore) url.searchParams.set('cursorScore', String(cursorScore));
    if (cuid) url.searchParams.set('cuid', cuid);

    let payload;
    try {
        payload = await page.fetchJson(url.toString(), { timeoutMs });
    }
    catch (error) {
        throw new CommandExecutionError(`Nowcoder recommend page ${pageNumber} failed: ${error?.message || error}`);
    }
    if (!payload || typeof payload.success !== 'boolean' || !Number.isSafeInteger(payload.code)) {
        throw new CommandExecutionError(`Nowcoder recommend page ${pageNumber} returned a malformed envelope`);
    }
    if (!payload.success || payload.code !== 0) {
        throw new CommandExecutionError(
            `Nowcoder recommend page ${pageNumber} failed: ${payload.msg || 'unknown error'} (${payload.code})`,
        );
    }
    if (!Array.isArray(payload.data?.records)) {
        throw new CommandExecutionError(`Nowcoder recommend page ${pageNumber} returned malformed records`);
    }
    return payload.data.records;
}

cli({
    site: 'nowcoder',
    name: 'recommend',
    access: 'read',
    description: 'Recommended feed with cursor-correct pagination',
    domain: 'www.nowcoder.com',
    strategy: Strategy.PUBLIC,
    browser: true,
    navigateBefore: false,
    args: [
        { name: 'page', type: 'int', default: 1, help: 'Page number' },
        { name: 'limit', type: 'int', default: 15, help: 'Number of items (1-50)' },
    ],
    columns: ['rank', 'post_type', 'id', 'title', 'author', 'company', 'content', 'url', 'likes', 'comments', 'views'],
    validateArgs,
    func: async (page, args) => {
        const targetPage = positiveInteger(args.page ?? 1, 'page', 1000);
        const limit = positiveInteger(args.limit ?? 15, 'limit', 50);

        await page.goto(NOWCODER_HOME);
        await page.wait(1);
        const cuid = await readVisitUserId(page);

        const seen = new Set();
        const rows = [];
        const deadline = Date.now() + 60_000;
        let currentPage = 1;
        let cursorScore = 0;
        let unsupportedTargetRows = 0;

        while (rows.length < limit) {
            const remaining = deadline - Date.now();
            if (remaining <= 0) {
                throw new CommandExecutionError(
                    `Nowcoder recommend page ${targetPage} exceeded the 60 second cursor replay budget`,
                );
            }
            const records = await fetchPage(page, currentPage, cursorScore, cuid, Math.min(15_000, remaining));
            if (Date.now() > deadline) {
                throw new CommandExecutionError(
                    `Nowcoder recommend page ${targetPage} exceeded the 60 second cursor replay budget`,
                );
            }
            if (records.length === 0) break;

            let pageCursor = 0;
            for (const record of records) {
                const recordCursor = record?.recommendData?.cursorScore;
                if (typeof recordCursor === 'number' && Number.isFinite(recordCursor)) {
                    pageCursor = recordCursor;
                }
                const key = recordKey(record);
                if (key) {
                    if (seen.has(key)) continue;
                    seen.add(key);
                }
                if (currentPage >= targetPage) {
                    const row = mapRecord(record, rows.length);
                    if (row) {
                        rows.push(row);
                        if (rows.length >= limit) break;
                    }
                    else {
                        unsupportedTargetRows += 1;
                    }
                }
            }

            if (rows.length >= limit) break;
            if (!pageCursor || pageCursor === cursorScore) break;
            cursorScore = pageCursor;
            currentPage += 1;
        }

        if (rows.length === 0) {
            if (unsupportedTargetRows > 0) {
                throw new CommandExecutionError(
                    `Nowcoder recommend page ${targetPage} returned only unsupported feed records`,
                );
            }
            throw new EmptyResultError(
                'nowcoder recommend',
                `No new records were available for page ${targetPage}`,
            );
        }
        return rows.slice(0, limit).map((row, index) => ({ ...row, rank: index + 1 }));
    },
});
