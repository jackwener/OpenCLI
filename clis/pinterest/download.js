// Pinterest download — save a pin's media (image, video, or every slide of a carousel / story
// pin) to disk, for one pin or for a whole board / board section (PinResource + downloadMedia).
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { checkYtdlp } from '@jackwener/opencli/download';
import { downloadMedia } from '@jackwener/opencli/download/media-download';
import { ArgumentError, CommandExecutionError, EmptyResultError, getErrorMessage } from '@jackwener/opencli/errors';
import {
  MAX_PIN_LIMIT,
  PINTEREST_BASE,
  SECTION_PAGE_SIZE,
  collectPinMedia,
  collectResults,
  parsePinId,
  pinMediaType,
  pinterestResourceFetch,
  requireBookmark,
  requireLimit,
  resolveBoardId,
  resolveBoardTarget,
  resolveSection,
} from './utils.js';

const DEFAULT_LIMIT = 25;
const DEFAULT_EXT = { image: '.jpg', video: '.mp4' };

/** Fetch the full pin; only `detailed` carries mp4 renditions and every carousel slot. */
async function fetchPinDetail(page, id) {
  const sourceUrl = `/pin/${id}/`;
  const { data: pin } = await pinterestResourceFetch(page, 'PinResource', { id, field_set_key: 'detailed' }, sourceUrl);
  return pin && pin.id ? pin : null;
}

/**
 * Turn one pin into downloadMedia items. Single-media pins keep the plain <id>.<ext> name;
 * multi-media pins get a 1-based suffix. An HLS-only video is routed to yt-dlp and saved as mp4.
 */
function toMediaItems(pin) {
  const id = String(pin.id);
  const media = collectPinMedia(pin);
  return media.map((item, i) => {
    const ext = item.hls ? '.mp4' : (path.extname(new URL(item.url).pathname) || DEFAULT_EXT[item.kind]);
    // pinId / index ride along so each downloadMedia result can be mapped back to its pin.
    const mediaItem = {
      pinId: id,
      index: i + 1,
      type: item.kind === 'image' ? 'image' : (item.hls ? 'video-ytdlp' : 'video'),
      url: item.url,
      filename: media.length === 1 ? `${id}${ext}` : `${id}_${i + 1}${ext}`,
    };
    return mediaItem;
  });
}

/** Download the items and map downloadMedia's per-file results back onto their pins. */
async function downloadItems(items, output) {
  const results = await downloadMedia(items, { output, timeout: 300000 });
  return items.map((item, i) => {
    const result = results[i] || { status: 'failed', size: 'no result' };
    const ok = result.status === 'success';
    return {
      pinId: item.pinId,
      index: item.index,
      type: item.type === 'image' ? 'image' : 'video',
      status: ok ? 'success' : 'failed',
      // downloadMedia reports the error text in `size` when a file fails.
      size: result.size,
      path: ok ? path.join(output, item.filename) : '',
    };
  });
}

const failedRow = (pinId, message) => ({ pinId, index: 1, type: '', status: 'failed', size: message, path: '' });

cli({
  site: 'pinterest',
  name: 'download',
  access: 'read',
  description: 'Download the media of a pin, or of every pin on a board / board section',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'pin', type: 'string', positional: true, help: 'Pin id or pin URL, e.g. 1234567890123456 (omit when using --board)' },
    { name: 'output', type: 'string', default: './pinterest-downloads', help: 'Output directory' },
    { name: 'board', type: 'string', default: '', help: 'Download every pin on this board instead: <username>/<slug>, board URL, or board id' },
    { name: 'section', type: 'string', default: '', help: 'With --board: only this board section (id or slug)' },
    { name: 'limit', type: 'int', default: DEFAULT_LIMIT, help: `With --board: number of pins (max ${MAX_PIN_LIMIT})` },
    { name: 'bookmark', type: 'string', default: '', help: 'With --board: resume from the nextBookmark of a previous call' },
    // Declaring `timeout` makes the runtime use it as the command deadline instead of the 60s
    // browser default, which a board download of a few dozen files can exceed.
    { name: 'timeout', type: 'int', default: 600, help: 'Max seconds for the whole download (default 600)' },
  ],
  columns: ['pinId', 'index', 'type', 'status', 'size', 'path', 'nextBookmark'],
  func: async (page, kwargs) => {
    const output = String(kwargs.output ?? './pinterest-downloads');
    const boardRef = String(kwargs.board ?? '').trim();
    const section = String(kwargs.section ?? '').trim();
    const hasPin = String(kwargs.pin ?? '').trim() !== '';

    if (hasPin === Boolean(boardRef)) {
      throw new ArgumentError('pass either a pin or --board', 'e.g. `download 1234567890123456` or `download --board janedoe/my-board`');
    }
    if (section && !boardRef) {
      throw new ArgumentError('--section requires --board', 'Sections belong to a board, so pass --board too');
    }

    // Without yt-dlp, downloadMedia would save the playlist text itself as the "video".
    const hasYtdlp = checkYtdlp();
    const HLS_HINT = 'Pinterest serves this video as an HLS playlist only; install yt-dlp to download it';

    if (hasPin) {
      const id = parsePinId(kwargs.pin);
      await page.goto(`${PINTEREST_BASE}/pin/${id}/`);
      const pin = await fetchPinDetail(page, id);
      if (!pin) {
        throw new EmptyResultError('pinterest download', `pin "${id}" not found`);
      }
      const items = toMediaItems(pin);
      if (items.length === 0) {
        throw new CommandExecutionError(`Pin ${id} has no downloadable media`);
      }
      if (!hasYtdlp && items.some((item) => item.type === 'video-ytdlp')) {
        throw new CommandExecutionError(`Pin ${id} cannot be downloaded without yt-dlp`, HLS_HINT);
      }
      const rows = await downloadItems(items, output);
      const failed = rows.filter((row) => row.status !== 'success');
      // A single pin either downloads completely or the command fails, as before.
      if (failed.length > 0) {
        throw new CommandExecutionError(`Failed to download pin ${id}: ${failed.map((row) => `#${row.index} ${row.size}`).join('; ')}`);
      }
      return rows.map((row) => ({ ...row, nextBookmark: '' }));
    }

    const limit = requireLimit(kwargs.limit, { fallback: DEFAULT_LIMIT, max: MAX_PIN_LIMIT });
    const bookmark = requireBookmark(kwargs.bookmark);
    const { username, slug, path: boardPath, board: preloadedBoard } = await resolveBoardTarget(page, boardRef);
    await page.goto(`${PINTEREST_BASE}${boardPath}`);
    const { boardId } = await resolveBoardId(page, username, slug, boardPath, preloadedBoard);

    let feed;
    if (section) {
      const resolved = await resolveSection(page, boardId, section, boardPath);
      feed = {
        resource: 'BoardSectionPinsResource',
        baseOptions: { section_id: resolved.sectionId, field_set_key: 'grid_item' },
        sourceUrl: resolved.slug ? `${boardPath}${resolved.slug}/` : boardPath,
        maxPageSize: SECTION_PAGE_SIZE,
      };
    } else {
      feed = {
        resource: 'BoardFeedResource',
        baseOptions: {
          board_id: boardId,
          field_set_key: 'grid_item',
          filter_section_pins: true,
        },
        sourceUrl: boardPath,
      };
    }

    const pins = await collectResults(page, {
      ...feed,
      limit,
      bookmark,
      exposeCursor: true,
      keyField: 'pinId',
      mapItem: (pin) => (pin && pin.type === 'pin' && !pin.is_promoted ? { pinId: String(pin.id ?? ''), pin } : null),
    });
    if (pins.length === 0) {
      throw new EmptyResultError('pinterest download', bookmark ? `no more pins on board "${username}/${slug}"` : `no pins found on board "${username}/${slug}"`);
    }
    const nextBookmark = pins[0].nextBookmark;

    // Resolve every pin's media first, so the files download in one pass with one progress view.
    const items = [];
    const skipped = [];
    for (const { pinId, pin: gridPin } of pins) {
      // The grid payload is enough for a plain image; anything else needs the detailed pin.
      let pin = gridPin;
      if (pinMediaType(gridPin) !== 'image') {
        try {
          pin = await fetchPinDetail(page, pinId);
        } catch (err) {
          skipped.push(failedRow(pinId, getErrorMessage(err)));
          continue;
        }
        if (!pin) {
          skipped.push(failedRow(pinId, 'pin not found'));
          continue;
        }
      }
      const pinItems = toMediaItems(pin);
      if (pinItems.length === 0) {
        skipped.push(failedRow(pinId, 'pin has no downloadable media'));
      } else if (!hasYtdlp && pinItems.some((item) => item.type === 'video-ytdlp')) {
        skipped.push(failedRow(pinId, HLS_HINT));
      } else {
        items.push(...pinItems);
      }
    }

    const rows = [...(items.length > 0 ? await downloadItems(items, output) : []), ...skipped];

    // Per-file failures are reported in the rows, but a run that saved nothing is a failure.
    if (!rows.some((row) => row.status === 'success')) {
      throw new CommandExecutionError(`No media could be downloaded from board "${username}/${slug}": ${rows[0].size}`);
    }
    return rows.map((row) => ({ ...row, nextBookmark }));
  },
});
