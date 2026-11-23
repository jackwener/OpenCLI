import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';

const PAGE_PAUSE_S = 0.5;

/** Unix seconds → `YYYY-MM-DD HH:mm:ss` in China time. */
export function formatChinaTime(seconds) {
    const n = Number(seconds);
    if (!Number.isFinite(n) || n <= 0) return '';
    return new Date(n * 1000).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false });
}

export function requireCount(value, def, max, name = 'limit') {
    const raw = value == null || value === '' ? def : value;
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
    if (!Number.isInteger(n) || n < 1 || n > max) throw new ArgumentError(`--${name} must be an integer between 1 and ${max}`);
    return n;
}

/**
 * Walk a cursor-paged Douyin list until it runs out, `want` rows are kept, or
 * the cursor stops advancing. `fetchPage(cursor)` returns the raw JSON.
 */
export async function walkPages(page, fetchPage, listKey, want, onItem) {
    let cursor = 0;
    let kept = 0;
    for (;;) {
        const data = await fetchPage(cursor);
        const list = data?.[listKey];
        if (list != null && !Array.isArray(list)) throw new CommandExecutionError(`Malformed Douyin response: ${listKey} is not a list`);
        for (const item of list ?? []) {
            if (kept >= want) return;
            if (onItem(item)) kept++;
        }
        const next = Number(data?.cursor);
        if (kept >= want || !data?.has_more || !list?.length || !Number.isFinite(next) || next <= cursor) return;
        cursor = next;
        await page.wait({ time: PAGE_PAUSE_S });
    }
}
