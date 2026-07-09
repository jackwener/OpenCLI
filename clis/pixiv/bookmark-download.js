import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { formatCookieHeader, httpDownload } from '@jackwener/opencli/download';
import { getErrorMessage } from '@jackwener/opencli/errors';
import { pixivFetch } from './utils.js';
import { fetchCurrentBookmarks, normalizeBookmarkType } from './bookmark-utils.js';
import { fetchNovelForDownload, normalizeNovelFileFormat, writeNovelFile } from './novel-download-utils.js';

function extFromUrl(url) {
  try {
    return path.extname(new URL(url).pathname) || '.jpg';
  } catch {
    return '.jpg';
  }
}

async function downloadIllustBookmark(page, row, output, cookies) {
  const outputDir = path.join(output, 'illust', row.illust_id);
  fs.mkdirSync(outputDir, { recursive: true });
  const pages = await pixivFetch(page, `/ajax/illust/${row.illust_id}/pages`, {
    notFoundMsg: `Illustration not found: ${row.illust_id}`,
  });
  if (!Array.isArray(pages)) {
    throw new Error('Pixiv pages API returned malformed payload');
  }
  for (let i = 0; i < pages.length; i++) {
    const url = pages[i]?.urls?.original || pages[i]?.urls?.regular || '';
    if (!url) {
      throw new Error(`Missing image URL for page ${i}`);
    }
    const destPath = path.join(outputDir, `${row.illust_id}_p${i}${extFromUrl(url)}`);
    const result = await httpDownload(url, destPath, {
      cookies,
      headers: { Referer: 'https://www.pixiv.net/' },
      timeout: 60000,
    });
    if (!result.success) {
      throw new Error(result.error || 'download failed');
    }
  }
  return outputDir;
}

async function downloadNovelBookmark(page, row, output, format) {
  const outputDir = path.join(output, 'novel');
  const body = await fetchNovelForDownload(page, row.novel_id);
  return writeNovelFile(body, outputDir, format);
}

cli({
  site: 'pixiv',
  name: 'bookmark-download',
  access: 'read',
  description: 'Batch download current Pixiv account bookmarks for illustrations or novels',
  domain: 'www.pixiv.net',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'type', default: 'illust', help: 'Bookmark type: illust or novel' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of bookmarks to download' },
    { name: 'offset', type: 'int', default: 0, help: 'Pagination offset' },
    { name: 'visibility', default: 'show', help: 'Bookmark visibility: show(public) or hide(private)' },
    { name: 'output', default: './pixiv-downloads/bookmarks', help: 'Output directory' },
    { name: 'file-format', default: 'txt', help: 'Novel output file format: txt or md' },
  ],
  columns: ['rank', 'type', 'id', 'title', 'status', 'download_status', 'path', 'error'],
  func: async (page, kwargs) => {
    const type = normalizeBookmarkType(kwargs.type);
    const output = String(kwargs.output ?? './pixiv-downloads/bookmarks');
    const format = normalizeNovelFileFormat(kwargs['file-format'] ?? kwargs.format ?? 'txt');
    const rows = await fetchCurrentBookmarks(page, kwargs);
    const cookies = type === 'illust' ? formatCookieHeader(await page.getCookies({ domain: 'pixiv.net' })) : '';
    const results = [];
    for (const row of rows) {
      const id = type === 'novel' ? row.novel_id : row.illust_id;
      try {
        const destPath = type === 'novel'
          ? await downloadNovelBookmark(page, row, output, format)
          : await downloadIllustBookmark(page, row, output, cookies);
        results.push({ rank: row.rank, type, id, title: row.title, status: 'success', download_status: 'success', path: destPath });
      } catch (error) {
        results.push({ rank: row.rank, type, id, title: row.title, status: 'failed', download_status: 'failed', path: '', error: getErrorMessage(error) });
      }
    }
    return results;
  },
});
