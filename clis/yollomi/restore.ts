/**
 * Yollomi photo restoration — POST /api/ai/photo-restoration
 */

import * as path from 'node:path';
import chalk from 'chalk';
import { cli, Strategy } from '../../src/registry.js';
import { CliError } from '../../src/errors.js';
import { YOLLOMI_DOMAIN, yollomiPost, downloadOutput, fmtBytes } from './utils.js';

cli({
  site: 'yollomi',
  name: 'restore',
  description: 'Restore old or damaged photos with AI (4 credits)',
  domain: YOLLOMI_DOMAIN,
  strategy: Strategy.COOKIE,
  args: [
    { name: 'image', positional: true, required: true, help: 'Image URL to restore' },
    { name: 'output', default: './yollomi-output', help: 'Output directory' },
    { name: 'no-download', type: 'boolean', default: false, help: 'Only show URL' },
  ],
  columns: ['status', 'file', 'size', 'url'],
  func: async (page, kwargs) => {
    process.stderr.write(chalk.dim('Restoring photo...\n'));
    const data = await yollomiPost(page, '/api/ai/photo-restoration', { imageUrl: kwargs.image as string });

    const url = data.image || (data.images?.[0]);
    if (!url) throw new CliError('EMPTY_RESPONSE', 'No result', 'Check the input image');

    if (kwargs['no-download']) return [{ status: 'restored', file: '-', size: '-', url }];

    try {
      const filename = `yollomi_restored_${Date.now()}.jpg`;
      const { path: fp, size } = await downloadOutput(url, kwargs.output as string, filename);
      return [{ status: 'saved', file: path.relative('.', fp), size: fmtBytes(size), url }];
    } catch {
      return [{ status: 'download-failed', file: '-', size: '-', url }];
    }
  },
});
