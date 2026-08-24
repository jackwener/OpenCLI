import * as fs from 'node:fs';
import * as path from 'node:path';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { pixivFetch } from './utils.js';
import { dateOnly, tagsToString } from './bookmark-utils.js';

function optionalDownloadCount(value, label) {
  if (value == null || value === '') return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new CommandExecutionError(`Pixiv novel ${label} returned malformed data`);
  }
  return value;
}

function requireNovelDownloadBody(body, id) {
  if (!body || Array.isArray(body) || typeof body !== 'object') {
    throw new CommandExecutionError(`Pixiv novel ${id} returned malformed detail payload`);
  }
  const novelId = String(body.id ?? '').trim();
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const author = typeof body.userName === 'string' ? body.userName.trim() : '';
  const userId = String(body.userId ?? '').trim();
  if (typeof body.content !== 'string') {
    throw new CommandExecutionError(`Pixiv novel ${id} returned malformed content payload`);
  }
  if (!/^\d+$/.test(novelId) || novelId !== id || !title || !author || !/^\d+$/.test(userId)) {
    throw new CommandExecutionError(`Pixiv novel ${id} returned malformed detail payload`);
  }
  // Validate metadata before any file is planned or created.
  tagsToString(body.tags);
  const createdDate = dateOnly(body.createDate);
  const wordCount = optionalDownloadCount(body.wordCount, 'word count');
  const bookmarkCount = optionalDownloadCount(body.bookmarkCount, 'bookmark count');
  return {
    ...body,
    id: novelId,
    title,
    userName: author,
    userId,
    content: body.content,
    createdDate,
    wordCount,
    bookmarkCount,
  };
}

export function normalizeNovelFileFormat(value) {
  if (value !== undefined && typeof value !== 'string') {
    throw new ArgumentError('Novel download format must be txt or md');
  }
  const format = (value ?? 'txt').toLowerCase();
  if (format !== 'txt' && format !== 'md') {
    throw new ArgumentError(`Unsupported novel download format: ${format}. Supported formats: txt, md.`);
  }
  return format;
}

export function normalizePixivOutputRoot(value, fallback) {
  if (value !== undefined && typeof value !== 'string') {
    throw new ArgumentError('output must be a directory path');
  }
  const raw = value ?? fallback;
  if (!raw || raw.includes('\0')) {
    throw new ArgumentError('output must be a non-empty directory path');
  }
  const resolved = path.resolve(raw);
  let ancestor = resolved;
  const missingParts = [];
  let ancestorStat;
  while (!ancestorStat) {
    try {
      ancestorStat = fs.lstatSync(ancestor);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw new ArgumentError(`output path is not a safe directory: ${ancestor}`);
      }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) {
        throw new ArgumentError(`output path is not a safe directory: ${resolved}`);
      }
      missingParts.unshift(path.basename(ancestor));
      ancestor = parent;
    }
  }
  if (ancestor === resolved && ancestorStat.isSymbolicLink()) {
    throw new ArgumentError(`output path must not be a symbolic link: ${resolved}`);
  }
  let canonicalAncestor;
  try {
    canonicalAncestor = fs.realpathSync.native(ancestor);
  } catch {
    throw new ArgumentError(`output path is not a safe directory: ${ancestor}`);
  }
  if (!fs.statSync(canonicalAncestor).isDirectory()) {
    throw new ArgumentError(`output path is not a safe directory: ${ancestor}`);
  }
  return path.join(canonicalAncestor, ...missingParts);
}

export function pixivPathEntryExists(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw new CommandExecutionError(`Failed to inspect Pixiv download target ${target}: ${error?.message || error}`);
  }
}

export async function fetchNovelForDownload(page, id) {
  const body = await pixivFetch(page, `/ajax/novel/${id}`, {
    notFoundMsg: `Novel not found: ${id}`,
  });
  return requireNovelDownloadBody(body, id);
}

export function formatNovelContent(body, format) {
  const tags = tagsToString(body.tags);
  const url = `https://www.pixiv.net/novel/show.php?id=${body.id}`;
  if (format === 'md') {
    return [
      `# ${body.title}`,
      '',
      `- Author: ${body.userName}`,
      `- User ID: ${body.userId}`,
      `- Novel ID: ${body.id}`,
      `- URL: ${url}`,
      body.createdDate ? `- Created: ${body.createdDate}` : '',
      tags ? `- Tags: ${tags}` : '',
      body.wordCount != null ? `- Words: ${body.wordCount}` : '',
      body.bookmarkCount != null ? `- Bookmarks: ${body.bookmarkCount}` : '',
      '',
      '---',
      '',
      body.content,
      '',
    ].filter(line => line !== '').join('\n');
  }
  return [
    `Title: ${body.title}`,
    `Author: ${body.userName}`,
    `User ID: ${body.userId}`,
    `Novel ID: ${body.id}`,
    `URL: ${url}`,
    body.createdDate ? `Created: ${body.createdDate}` : '',
    tags ? `Tags: ${tags}` : '',
    body.wordCount != null ? `Words: ${body.wordCount}` : '',
    body.bookmarkCount != null ? `Bookmarks: ${body.bookmarkCount}` : '',
    '',
    body.content,
    '',
  ].filter(line => line !== '').join('\n');
}

export function prepareNovelFile(body, output, format) {
  const outputDir = normalizePixivOutputRoot(output, './pixiv-downloads/novels');
  const filename = `${body.id}.${format}`;
  const destPath = path.join(outputDir, filename);
  if (pixivPathEntryExists(destPath)) {
    throw new CommandExecutionError(`Refusing to overwrite existing Pixiv download: ${destPath}`);
  }
  const createdDirs = [];
  for (let cursor = outputDir; !fs.existsSync(cursor); cursor = path.dirname(cursor)) {
    createdDirs.push(cursor);
    if (path.dirname(cursor) === cursor) break;
  }
  return {
    kind: 'novel',
    outputDir,
    createdDirs,
    destPath,
    content: formatNovelContent(body, format),
  };
}

export function writeNovelFile(body, output, format) {
  return commitNovelFile(prepareNovelFile(body, output, format));
}

export function commitNovelFile(plan) {
  let descriptor;
  try {
    fs.mkdirSync(plan.outputDir, { recursive: true });
    descriptor = fs.openSync(plan.destPath, 'wx');
    fs.writeFileSync(descriptor, plan.content, 'utf8');
    fs.closeSync(descriptor);
    descriptor = undefined;
    return plan.destPath;
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
      try { fs.rmSync(plan.destPath, { force: true }); } catch {}
    }
    for (const directory of plan.createdDirs) {
      try { fs.rmdirSync(directory); } catch {}
    }
    if (error instanceof CommandExecutionError) throw error;
    throw new CommandExecutionError(`Failed to write Pixiv novel ${path.basename(plan.destPath)}: ${error?.message || error}`);
  }
}

export function cleanupNovelFile(plan) {
  try { fs.rmSync(plan.destPath, { force: true }); } catch {}
  for (const directory of plan.createdDirs) {
    try { fs.rmdirSync(directory); } catch {}
  }
}
