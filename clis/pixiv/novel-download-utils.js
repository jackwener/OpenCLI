import * as fs from 'node:fs';
import * as path from 'node:path';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { pixivFetch } from './utils.js';
import { tagsToString } from './bookmark-utils.js';

function sanitizeFilename(value) {
  return String(value || 'untitled')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'untitled';
}

function requireNovelDownloadBody(body, id) {
  if (!body || Array.isArray(body) || typeof body !== 'object') {
    throw new CommandExecutionError(`Pixiv novel ${id} returned malformed detail payload`);
  }
  const novelId = String(body.id ?? '').trim();
  const title = String(body.title ?? '').trim();
  const author = String(body.userName ?? '').trim();
  const userId = String(body.userId ?? '').trim();
  if (typeof body.content !== 'string') {
    throw new CommandExecutionError(`Pixiv novel ${id} returned malformed content payload`);
  }
  const content = body.content;
  if (!/^\d+$/.test(novelId) || novelId !== id || !title || !author || !/^\d+$/.test(userId)) {
    throw new CommandExecutionError(`Pixiv novel ${id} returned malformed detail payload`);
  }
  return { ...body, id: novelId, title, userName: author, userId, content };
}

export function normalizeNovelFileFormat(value) {
  const format = String(value ?? 'txt').toLowerCase();
  if (format !== 'txt' && format !== 'md') {
    throw new ArgumentError(`Unsupported novel download format: ${format}. Supported formats: txt, md.`);
  }
  return format;
}

export async function fetchNovelForDownload(page, id) {
  const body = await pixivFetch(page, `/ajax/novel/${id}`, {
    notFoundMsg: `Novel not found: ${id}`,
  });
  return requireNovelDownloadBody(body, id);
}

export function formatNovelContent(body, format) {
  const tags = tagsToString(body.tags);
  const created = typeof body.createDate === 'string' ? body.createDate.split('T')[0] : '';
  const url = `https://www.pixiv.net/novel/show.php?id=${body.id}`;
  if (format === 'md') {
    return [
      `# ${body.title}`,
      '',
      `- Author: ${body.userName}`,
      `- User ID: ${body.userId}`,
      `- Novel ID: ${body.id}`,
      `- URL: ${url}`,
      created ? `- Created: ${created}` : '',
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
    created ? `Created: ${created}` : '',
    tags ? `Tags: ${tags}` : '',
    body.wordCount != null ? `Words: ${body.wordCount}` : '',
    body.bookmarkCount != null ? `Bookmarks: ${body.bookmarkCount}` : '',
    '',
    body.content,
    '',
  ].filter(line => line !== '').join('\n');
}

export function writeNovelFile(body, output, format) {
  fs.mkdirSync(output, { recursive: true });
  const filename = `${body.id}-${sanitizeFilename(body.title)}.${format}`;
  const destPath = path.join(output, filename);
  fs.writeFileSync(destPath, formatNovelContent(body, format));
  return destPath;
}
