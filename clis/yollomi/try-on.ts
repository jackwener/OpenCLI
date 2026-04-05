/**
 * Yollomi virtual try-on — POST /api/ai/virtual-try-on
 */

import * as path from 'node:path';
import chalk from 'chalk';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { YOLLOMI_DOMAIN, yollomiPost, downloadOutput, fmtBytes } from './utils.js';

cli({
  site: 'yollomi',
  name: 'try-on',
  description: 'Virtual try-on — see how clothes look on a person (3 credits)',
  domain: YOLLOMI_DOMAIN,
  strategy: Strategy.COOKIE,
  args: [
    { name: 'person', required: true, help: 'Person photo URL (upload via "opencli yollomi upload" first)' },
    { name: 'cloth', required: true, help: 'Clothing image URL' },
    { name: 'cloth-type', default: 'upper', choices: ['upper', 'lower', 'overall'], help: 'Clothing type' },
    { name: 'output', default: './yollomi-output', help: 'Output directory' },
    { name: 'no-download', type: 'boolean', default: false, help: 'Only show URL' },
  ],
  columns: ['status', 'file', 'size', 'url'],
  func: async (page, kwargs) => {
    process.stderr.write(chalk.dim('Processing virtual try-on...\n'));
    const data = await yollomiPost(page, '/api/ai/virtual-try-on', {
      person_image: kwargs.person as string,
      cloth_image: kwargs.cloth as string,
      cloth_type: kwargs['cloth-type'] as string,
      output_format: 'png',
      output_quality: 100,
    });

    const url = data.image || (data.images?.[0]);
    if (!url) throw new CliError('EMPTY_RESPONSE', 'No result', 'Check both images have clear subjects');

    if (kwargs['no-download']) return [{ status: 'generated', file: '-', size: '-', url }];

    try {
      const filename = `yollomi_tryon_${Date.now()}.png`;
      const { path: fp, size } = await downloadOutput(url, kwargs.output as string, filename);
      return [{ status: 'saved', file: path.relative('.', fp), size: fmtBytes(size), url }];
    } catch {
      return [{ status: 'download-failed', file: '-', size: '-', url }];
    }
  },
});
