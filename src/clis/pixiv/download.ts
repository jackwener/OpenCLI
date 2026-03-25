/**
 * Pixiv download — download all images from an illustration.
 *
 * Pixiv's CDN (i.pximg.net) requires Referer: https://www.pixiv.net/ header.
 * Uses the /ajax/illust/{id}/pages API to get original-quality image URLs.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { cli, Strategy } from '../../registry.js';
import { formatCookieHeader, httpDownload } from '../../download/index.js';
import { formatBytes } from '../../download/progress.js';
import { CommandExecutionError, getErrorMessage } from '../../errors.js';
import { pixivFetch } from './utils.js';

cli({
  site: 'pixiv',
  name: 'download',
  description: 'Download illustration images from Pixiv',
  domain: 'www.pixiv.net',
  strategy: Strategy.COOKIE,
  args: [
    { name: 'illust-id', positional: true, required: true, help: 'Illustration ID' },
    { name: 'output', default: './pixiv-downloads', help: 'Output directory' },
  ],
  columns: ['index', 'type', 'status', 'size'],

  func: async (page, kwargs) => {
    const illustId = String(kwargs['illust-id'] ?? '');
    const output = String(kwargs.output ?? './pixiv-downloads');

    if (!/^\d+$/.test(illustId)) {
      throw new CommandExecutionError(`Invalid illustration ID: ${illustId}`);
    }

    // pixivFetch handles navigate + error checking; returns the response body directly
    const pages: any[] = await pixivFetch(page, `/ajax/illust/${illustId}/pages`, {
      notFoundMsg: `Illustration not found: ${illustId}`,
    }) || [];

    if (pages.length === 0) {
      return [{ index: 0, type: '-', status: 'failed', size: 'No images found' }];
    }

    // Extract cookies for authenticated downloads
    const cookies = formatCookieHeader(await page.getCookies({ domain: 'pixiv.net' }));

    // Create output directory
    const outputDir = path.join(output, illustId);
    fs.mkdirSync(outputDir, { recursive: true });

    const results = [];

    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const url = p.urls?.original || p.urls?.regular || '';
      if (!url) {
        results.push({ index: i + 1, type: 'image', status: 'failed', size: 'No URL' });
        continue;
      }

      try {
        const ext = path.extname(new URL(url).pathname) || '.jpg';
        const filename = `${illustId}_p${i}${ext}`;
        const destPath = path.join(outputDir, filename);

        const result = await httpDownload(url, destPath, {
          cookies,
          headers: { Referer: 'https://www.pixiv.net/' },
          timeout: 60000,
        });

        results.push({
          index: i + 1,
          type: 'image',
          status: result.success ? 'success' : 'failed',
          size: result.success ? formatBytes(result.size) : (result.error || 'unknown error'),
        });
      } catch (err) {
        results.push({
          index: i + 1,
          type: 'image',
          status: 'failed',
          size: getErrorMessage(err),
        });
      }
    }

    return results;
  },
});
