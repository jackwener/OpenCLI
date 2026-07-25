// Pinterest download — save a pin's original image to disk (PinResource + httpDownload).
import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { httpDownload } from '@jackwener/opencli/download';
import { formatBytes } from '@jackwener/opencli/download/progress';
import { CommandExecutionError, EmptyResultError, getErrorMessage } from '@jackwener/opencli/errors';
import { PINTEREST_BASE, parsePinId, pickPinImage, pinterestResourceFetch } from './utils.js';

cli({
  site: 'pinterest',
  name: 'download',
  access: 'read',
  description: 'Download a pin\'s original image to disk',
  domain: 'www.pinterest.com',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'pin', type: 'string', positional: true, required: true, help: 'Pin id or pin URL, e.g. 1234567890123456' },
    { name: 'output', type: 'string', default: './pinterest-downloads', help: 'Output directory' },
  ],
  columns: ['pinId', 'status', 'size', 'path'],
  func: async (page, kwargs) => {
    const id = parsePinId(kwargs.pin);
    const output = String(kwargs.output ?? './pinterest-downloads');

    const sourceUrl = `/pin/${id}/`;
    await page.goto(`${PINTEREST_BASE}${sourceUrl}`);

    const { data: pin } = await pinterestResourceFetch(
      page,
      'PinResource',
      { id, field_set_key: 'detailed' },
      sourceUrl,
    );
    if (!pin || !pin.id) {
      throw new EmptyResultError('pinterest download', `pin "${id}" not found`);
    }
    const imageUrl = pickPinImage(pin.images);
    if (!imageUrl) {
      throw new CommandExecutionError(`Pin ${id} has no downloadable image (it may be a video or story pin)`);
    }

    fs.mkdirSync(output, { recursive: true });
    const ext = path.extname(new URL(imageUrl).pathname) || '.jpg';
    const destPath = path.join(output, `${id}${ext}`);

    let result;
    try {
      result = await httpDownload(imageUrl, destPath, { timeout: 60000 });
    } catch (err) {
      throw new CommandExecutionError(`Failed to download pin ${id}: ${getErrorMessage(err)}`);
    }
    if (!result.success) {
      throw new CommandExecutionError(`Failed to download pin ${id}: ${result.error || 'unknown error'}`);
    }

    return [{
      pinId: id,
      status: 'success',
      size: formatBytes(result.size),
      path: destPath,
    }];
  },
});
