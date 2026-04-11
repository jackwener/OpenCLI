import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { formatCookieHeader, httpDownload } from '@jackwener/opencli/download';
function sanitizeExtname(url) {
    try {
        const pathname = new URL(url).pathname || '';
        const ext = path.extname(pathname).toLowerCase();
        if (ext && ext.length <= 6)
            return ext;
    }
    catch {
        // ignore invalid URL and fall back
    }
    return '.jpg';
}
function hashUrl(url) {
    return createHash('sha1').update(url).digest('hex');
}
function buildDownloadPlan(rows, output) {
    const cacheDir = path.join(output, '.cache');
    const byUrl = new Map();
    rows.forEach((row, rowIndex) => {
        const courseId = row.course_id || 'course';
        const chapterId = row.chapter_id || 'root';
        const imageUrls = Array.isArray(row.images) ? row.images.filter(Boolean) : [];
        imageUrls.forEach((url, imageIndex) => {
            const ext = sanitizeExtname(url);
            const cachePath = path.join(cacheDir, `${hashUrl(url)}${ext}`);
            const destPath = path.join(output, courseId, chapterId, `${courseId}_${chapterId}_${imageIndex + 1}${ext}`);
            const existing = byUrl.get(url);
            if (existing) {
                existing.copies.push({ rowIndex, destPath });
                return;
            }
            byUrl.set(url, {
                url,
                cachePath,
                copies: [{ rowIndex, destPath }],
            });
        });
    });
    return Array.from(byUrl.values());
}
async function runWithConcurrency(items, concurrency, worker) {
    const limit = Math.max(1, Math.floor(concurrency));
    let cursor = 0;
    async function consume() {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            await worker(items[index]);
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => consume()));
}
function createDefaultDeps() {
    return {
        concurrency: 8,
        downloadToPath: async (url, destPath, cookies) => {
            const result = await httpDownload(url, destPath, {
                cookies,
                timeout: 60_000,
            });
            return result.success;
        },
    };
}
export async function downloadScysCourseImagesInternal(data, output, cookies, overrides = {}) {
    const rows = Array.isArray(data) ? data : [data];
    const deps = { ...createDefaultDeps(), ...overrides };
    const withDownloads = rows.map((row) => ({ ...row, image_count: 0, image_dir: '' }));
    const plan = buildDownloadPlan(withDownloads, output);
    const successCounts = new Array(withDownloads.length).fill(0);
    await fs.promises.mkdir(path.join(output, '.cache'), { recursive: true });
    await runWithConcurrency(plan, deps.concurrency, async (entry) => {
        let available = false;
        try {
            await fs.promises.access(entry.cachePath, fs.constants.F_OK);
            available = true;
        }
        catch {
            await fs.promises.mkdir(path.dirname(entry.cachePath), { recursive: true });
            available = await deps.downloadToPath(entry.url, entry.cachePath, cookies);
        }
        if (!available)
            return;
        await Promise.all(entry.copies.map(async (copy) => {
            await fs.promises.mkdir(path.dirname(copy.destPath), { recursive: true });
            await fs.promises.copyFile(entry.cachePath, copy.destPath);
            successCounts[copy.rowIndex] += 1;
        }));
    });
    const result = withDownloads.map((row, index) => ({
        ...row,
        image_count: successCounts[index] ?? 0,
        image_dir: row.images.length > 0 ? path.join(output, row.course_id || 'course', row.chapter_id || 'root') : '',
    }));
    return Array.isArray(data) ? result : result[0];
}
export async function downloadScysCourseImages(page, data, output) {
    const cookies = formatCookieHeader(await page.getCookies({ domain: 'scys.com' }));
    return downloadScysCourseImagesInternal(data, output, cookies);
}
