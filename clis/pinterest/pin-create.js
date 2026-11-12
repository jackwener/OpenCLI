// Pinterest pin-create — create a pin from a remote image URL or a local image file onto a board
// (PinResource/create).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError } from '@jackwener/opencli/errors';
import { PINTEREST_BASE, movePinToSection, pinterestResourceCreate, resolveBoardId, resolveBoardTarget, resolveSection } from './utils.js';

const UPLOAD_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff']);
// The image travels base64-encoded inside the create request, so keep it well under what the
// page can post in one form body.
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * Turn the image argument into the PinResource/create source options: a remote URL is scraped
 * by Pinterest, a local file is read here and sent inline (the same `image_base64` field the
 * pin builder posts), which also works for images Pinterest's scraper cannot reach.
 */
export function readImageSource(raw) {
  const value = String(raw ?? '').trim();
  if (!value) throw new ArgumentError('image is required (a remote image URL or a local file path)');

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new ArgumentError(`image is not a valid URL: "${raw}"`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new ArgumentError(`image URL must be http(s): ${value}`, 'For a local file pass its path, not a file:// URL');
    }
    return { image_url: value, method: 'scraped' };
  }

  const filePath = path.resolve(value);
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new ArgumentError(`image file not found: ${filePath}`, 'Pass an http(s) image URL or the path of an existing image file');
  }
  if (!stat.isFile()) {
    throw new ArgumentError(`image path is not a file: ${filePath}`);
  }
  const ext = path.extname(filePath).toLowerCase();
  if (!UPLOAD_EXTENSIONS.has(ext)) {
    throw new ArgumentError(`unsupported image type "${ext || '(none)'}"`, `Supported: ${[...UPLOAD_EXTENSIONS].join(', ')}`);
  }
  if (stat.size === 0 || stat.size > MAX_UPLOAD_BYTES) {
    throw new ArgumentError(`image file must be between 1 byte and ${MAX_UPLOAD_BYTES / 1024 / 1024} MB (got ${stat.size} bytes)`);
  }
  return { image_base64: fs.readFileSync(filePath).toString('base64'), method: 'uploaded' };
}

cli({
  site: 'pinterest',
  name: 'pin-create',
  access: 'write',
  description: 'Create a pin from an image URL or a local image file onto a board',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'image', type: 'string', positional: true, required: true, help: 'Direct image URL Pinterest can fetch (not a page URL), or a local image file path, e.g. https://example.com/image.jpg' },
    { name: 'board', type: 'string', required: true, help: 'Target board: <username>/<slug>, board URL, or board id (a new pin always needs a board)' },
    { name: 'section', type: 'string', default: '', help: 'Optional board section id or slug' },
    { name: 'title', type: 'string', default: '', help: 'Pin title' },
    // Pinterest ignores description for scraped pins (it derives one from the source page).
    { name: 'description', type: 'string', default: '', help: 'Pin description (Pinterest may override it for scraped images)' },
    { name: 'link', type: 'string', default: '', help: 'Destination link for the pin' },
    { name: 'alt-text', type: 'string', default: '', help: 'Alt text describing the image' },
  ],
  columns: ['pinId', 'board', 'title', 'url'],
  func: async (page, kwargs) => {
    const source = readImageSource(kwargs.image);
    const { username, slug, path: boardPath, board: preloadedBoard } = await resolveBoardTarget(page, kwargs.board);
    const section = String(kwargs.section ?? '').trim();
    const title = String(kwargs.title ?? '').trim();
    const description = String(kwargs.description ?? '').trim();
    const link = String(kwargs.link ?? '').trim();
    const altText = String(kwargs['alt-text'] ?? '').trim();

    await page.goto(`${PINTEREST_BASE}${boardPath}`);

    // Resolve the numeric board id the create call needs.
    const { boardId } = await resolveBoardId(page, username, slug, boardPath, preloadedBoard);

    // Validate --section before creating, so a bad value fails before a pin exists.
    const sectionId = section ? (await resolveSection(page, boardId, section, boardPath)).sectionId : '';

    const options = { board_id: boardId, ...source };
    if (title) options.title = title;
    if (description) options.description = description;
    if (link) options.link = link;
    if (altText) options.alt_text = altText;

    const created = await pinterestResourceCreate(page, 'PinResource', options, boardPath);
    const newId = created && created.id;
    if (!newId) {
      throw new CommandExecutionError('Pin creation did not return a pin id');
    }

    if (sectionId) {
      await movePinToSection(page, newId, boardId, sectionId, boardPath);
    }

    return [{
      pinId: String(newId),
      board: (created.board && created.board.name) || `${username}/${slug}`,
      title: (created.title || created.grid_title || title || '').trim(),
      url: `${PINTEREST_BASE}/pin/${newId}/`,
    }];
  },
});
