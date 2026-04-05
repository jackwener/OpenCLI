/**
 * Yollomi face swap — POST /api/ai/face-swap
 * Uses swap_image / input_image field names matching the frontend.
 */

import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { log } from '@jackwener/opencli/logger';
import { YOLLOMI_DOMAIN, yollomiPost, downloadOutput, fmtBytes } from './utils.js';

cli({
  site: 'yollomi',
  name: 'face-swap',
  description: 'Swap faces between two photos (3 credits)',
  domain: YOLLOMI_DOMAIN,
  strategy: Strategy.COOKIE,
  args: [
    { name: 'source', required: true, help: 'Source face image URL' },
    { name: 'target', required: true, help: 'Target photo URL' },
    { name: 'output', default: './yollomi-output', help: 'Output directory' },
    { name: 'no-download', type: 'boolean', default: false, help: 'Only show URL' },
  ],
  columns: ['status', 'file', 'size', 'url'],
  func: async (page, kwargs) => {
    log.status('Swapping faces...');
    const data = await yollomiPost(page, '/api/ai/face-swap', {
      swap_image: kwargs.source as string,
      input_image: kwargs.target as string,
    });

    const url = data.image || (data.images?.[0]);
    if (!url) throw new CliError('EMPTY_RESPONSE', 'No result', 'Make sure both images contain clear faces');

    if (kwargs['no-download']) return [{ status: 'swapped', file: '-', size: '-', url }];

    try {
      const filename = `yollomi_faceswap_${Date.now()}.jpg`;
      const { path: fp, size } = await downloadOutput(url, kwargs.output as string, filename);
      return [{ status: 'saved', file: path.relative('.', fp), size: fmtBytes(size), url }];
    } catch {
      return [{ status: 'download-failed', file: '-', size: '-', url }];
    }
  },
});
