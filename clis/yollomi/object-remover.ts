/**
 * Yollomi object remover — POST /api/ai/object-remover
 */

import * as path from 'node:path';
import chalk from 'chalk';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { YOLLOMI_DOMAIN, yollomiPost, downloadOutput, fmtBytes } from './utils.js';

cli({
  site: 'yollomi',
  name: 'object-remover',
  description: 'Remove unwanted objects from images (3 credits)',
  domain: YOLLOMI_DOMAIN,
  strategy: Strategy.COOKIE,
  args: [
    { name: 'image', positional: true, required: true, help: 'Image URL' },
    { name: 'mask', positional: true, required: true, help: 'Mask image URL (white = area to remove)' },
    { name: 'output', default: './yollomi-output', help: 'Output directory' },
    { name: 'no-download', type: 'boolean', default: false, help: 'Only show URL' },
  ],
  columns: ['status', 'file', 'size', 'url'],
  func: async (page, kwargs) => {
    process.stderr.write(chalk.dim('Removing object...\n'));
    const data = await yollomiPost(page, '/api/ai/object-remover', {
      image: kwargs.image as string,
      mask: kwargs.mask as string,
    });

    const url = data.image || (data.images?.[0]);
    if (!url) throw new CliError('EMPTY_RESPONSE', 'No result', 'Check image and mask');

    if (kwargs['no-download']) return [{ status: 'removed', file: '-', size: '-', url }];

    try {
      const filename = `yollomi_removed_${Date.now()}.png`;
      const { path: fp, size } = await downloadOutput(url, kwargs.output as string, filename);
      return [{ status: 'saved', file: path.relative('.', fp), size: fmtBytes(size), url }];
    } catch {
      return [{ status: 'download-failed', file: '-', size: '-', url }];
    }
  },
});
