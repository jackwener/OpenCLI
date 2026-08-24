import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { formatCookieHeader, httpDownload } from '@jackwener/opencli/download';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { pixivFetch } from './utils.js';
import { fetchCurrentBookmarks, normalizeBookmarkType } from './bookmark-utils.js';
import {
  cleanupNovelFile,
  commitNovelFile,
  fetchNovelForDownload,
  normalizeNovelFileFormat,
  normalizePixivOutputRoot,
  pixivPathEntryExists,
  prepareNovelFile,
} from './novel-download-utils.js';

const IMAGE_CONTENT_TYPES = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
]);

function requireExecute(value) {
  if (value !== true) {
    throw new ArgumentError('Refusing to write local Pixiv downloads: pass --execute');
  }
}

function parsePixivImageUrl(value, label) {
  if (typeof value !== 'string' || !value) {
    throw new CommandExecutionError(`${label} returned a missing image URL`);
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new CommandExecutionError(`${label} returned a malformed image URL`);
  }
  const extension = path.extname(url.pathname).toLowerCase();
  const contentType = IMAGE_CONTENT_TYPES.get(extension);
  if (url.protocol !== 'https:' || url.hostname !== 'i.pximg.net' || url.username || url.password || url.port || !contentType) {
    throw new CommandExecutionError(`${label} returned an untrusted Pixiv image URL`);
  }
  return { url: url.href, extension, contentType };
}

async function prepareIllustPlan(page, row, outputRoot) {
  const pages = await pixivFetch(page, `/ajax/illust/${row.illust_id}/pages`, {
    notFoundMsg: `Illustration not found: ${row.illust_id}`,
  });
  if (!Array.isArray(pages)) {
    throw new CommandExecutionError('Pixiv pages API returned malformed payload');
  }
  if (pages.length === 0) {
    throw new EmptyResultError('pixiv bookmark-download', `No images found for illustration ${row.illust_id}.`);
  }
  const files = pages.map((entry, index) => {
    if (!entry || Array.isArray(entry) || typeof entry !== 'object' || !entry.urls || Array.isArray(entry.urls) || typeof entry.urls !== 'object') {
      throw new CommandExecutionError(`Pixiv illustration ${row.illust_id} returned malformed page ${index + 1}`);
    }
    const parsed = parsePixivImageUrl(entry.urls.original || entry.urls.regular, `Pixiv illustration ${row.illust_id} page ${index + 1}`);
    return {
      ...parsed,
      filename: `${row.illust_id}_p${index}${parsed.extension}`,
    };
  });
  const finalPath = path.join(outputRoot, 'illust', row.illust_id);
  if (pixivPathEntryExists(finalPath)) {
    throw new CommandExecutionError(`Refusing to overwrite existing Pixiv download: ${finalPath}`);
  }
  const createdDirs = [];
  for (let cursor = path.dirname(finalPath); !fs.existsSync(cursor); cursor = path.dirname(cursor)) {
    createdDirs.push(cursor);
    if (path.dirname(cursor) === cursor) break;
  }
  return { kind: 'illust', illustId: row.illust_id, finalPath, files, createdDirs };
}

function validateImageDownload(result, file) {
  if (!result || typeof result !== 'object' || result.success !== true || !Number.isSafeInteger(result.size) || result.size <= 0) {
    throw new CommandExecutionError(`Pixiv image download failed: ${result?.error || 'invalid download result'}`);
  }
  const final = parsePixivImageUrl(result.finalUrl, 'Pixiv image download');
  if (final.contentType !== file.contentType || result.contentType !== file.contentType) {
    throw new CommandExecutionError(`Pixiv image download returned unexpected content type for ${file.filename}`);
  }
}

async function commitIllustPlan(plan, cookies) {
  const parent = path.dirname(plan.finalPath);
  let staging;
  try {
    fs.mkdirSync(parent, { recursive: true });
    staging = fs.mkdtempSync(path.join(parent, `.opencli-${plan.illustId}-`));
    for (const file of plan.files) {
      const destination = path.join(staging, file.filename);
      const result = await httpDownload(file.url, destination, {
        cookies,
        headers: { Referer: 'https://www.pixiv.net/' },
        timeout: 60000,
        includeContentType: true,
      });
      validateImageDownload(result, file);
      const stat = fs.lstatSync(destination);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size <= 0) {
        throw new CommandExecutionError(`Pixiv image download did not create a valid file: ${file.filename}`);
      }
    }
    if (pixivPathEntryExists(plan.finalPath)) {
      throw new CommandExecutionError(`Refusing to overwrite existing Pixiv download: ${plan.finalPath}`);
    }
    fs.renameSync(staging, plan.finalPath);
    return plan.finalPath;
  } catch (error) {
    if (staging) {
      try { fs.rmSync(staging, { recursive: true, force: true }); } catch {}
    }
    for (const directory of plan.createdDirs) {
      try { fs.rmdirSync(directory); } catch {}
    }
    if (error instanceof CommandExecutionError) throw error;
    throw new CommandExecutionError(`Pixiv illustration ${plan.illustId} download failed: ${error?.message || error}`);
  }
}

function cleanupPlan(plan) {
  if (plan.kind === 'novel') {
    cleanupNovelFile(plan);
    return;
  }
  try { fs.rmSync(plan.finalPath, { recursive: true, force: true }); } catch {}
  for (const directory of plan.createdDirs) {
    try { fs.rmdirSync(directory); } catch {}
  }
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
    { name: 'execute', type: 'boolean', default: false, help: 'Actually write the local archive' },
  ],
  columns: ['rank', 'type', 'id', 'title', 'download_status', 'path'],
  func: async (page, kwargs) => {
    requireExecute(kwargs.execute);
    const type = normalizeBookmarkType(kwargs.type);
    const format = normalizeNovelFileFormat(kwargs['file-format'] ?? kwargs.format ?? 'txt');
    const outputRoot = normalizePixivOutputRoot(kwargs.output, './pixiv-downloads/bookmarks');
    const rows = await fetchCurrentBookmarks(page, kwargs);
    if (rows.length === 0) {
      throw new EmptyResultError('pixiv bookmark-download', 'No Pixiv bookmarks matched the requested page.');
    }

    // Complete every API/schema/collision check before creating a file.
    const plans = [];
    for (const row of rows) {
      if (type === 'novel') {
        const body = await fetchNovelForDownload(page, row.novel_id);
        plans.push({ ...prepareNovelFile(body, path.join(outputRoot, 'novel'), format), row });
      } else {
        plans.push({ ...await prepareIllustPlan(page, row, outputRoot), row });
      }
    }
    const targets = new Set();
    for (const plan of plans) {
      const target = plan.kind === 'novel' ? plan.destPath : plan.finalPath;
      if (targets.has(target)) {
        throw new CommandExecutionError(`Pixiv bookmark archive contains a duplicate download target: ${target}`);
      }
      targets.add(target);
    }

    let cookies = '';
    if (type === 'illust') {
      let rawCookies;
      try {
        rawCookies = await page.getCookies({ domain: 'pixiv.net' });
      } catch (error) {
        throw new CommandExecutionError(`Pixiv cookie lookup failed: ${error?.message || error}`);
      }
      if (!Array.isArray(rawCookies)) {
        throw new CommandExecutionError('Pixiv cookie lookup returned malformed data');
      }
      try {
        cookies = formatCookieHeader(rawCookies);
      } catch (error) {
        throw new CommandExecutionError(`Pixiv cookie lookup returned malformed entries: ${error?.message || error}`);
      }
    }

    const committed = [];
    try {
      const results = [];
      for (const plan of plans) {
        const destination = plan.kind === 'novel'
          ? commitNovelFile(plan)
          : await commitIllustPlan(plan, cookies);
        committed.push(plan);
        const id = type === 'novel' ? plan.row.novel_id : plan.row.illust_id;
        results.push({
          rank: plan.row.rank,
          type,
          id,
          title: plan.row.title,
          download_status: 'success',
          path: destination,
        });
      }
      return results;
    } catch (error) {
      for (const plan of committed.reverse()) cleanupPlan(plan);
      if (error instanceof CommandExecutionError) throw error;
      throw new CommandExecutionError(`Pixiv bookmark archive failed: ${error?.message || error}`);
    }
  },
});
