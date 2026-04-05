/**
 * Yollomi image upscaling — POST /api/ai/image-upscaler
 */

import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { YOLLOMI_DOMAIN, yollomiPost, downloadOutput, fmtBytes, writeStatus } from './utils.js';

cli({
  site: 'yollomi',
  name: 'upscale',
  description: 'Upscale image resolution with AI (1 credit)',
  domain: YOLLOMI_DOMAIN,
  strategy: Strategy.COOKIE,
  args: [
    { name: 'image', positional: true, required: true, help: 'Image URL to upscale' },
    { name: 'scale', default: '2', choices: ['2', '4'], help: 'Upscale factor (2 or 4)' },
    { name: 'output', default: './yollomi-output', help: 'Output directory' },
    { name: 'no-download', type: 'boolean', default: false, help: 'Only show URL' },
  ],
  columns: ['status', 'file', 'size', 'scale', 'url'],
  func: async (page, kwargs) => {
    const scale = parseInt(kwargs.scale as string, 10);
    writeStatus(`Upscaling ${scale}x...`);
    const data = await yollomiPost(page, '/api/ai/image-upscaler', {
      imageUrl: kwargs.image as string,
      scale,
      face_enhance: false,
    });

    const url = data.image || (data.images?.[0]);
    if (!url) throw new CliError('EMPTY_RESPONSE', 'No result', 'Check the input image');

    if (kwargs['no-download']) return [{ status: 'upscaled', file: '-', size: '-', scale: `${scale}x`, url }];

    try {
      const urlPath = (() => { try { return new URL(url).pathname; } catch { return url; } })();
      const ext = urlPath.endsWith('.png') || urlPath.endsWith('.webp') ? urlPath.slice(urlPath.lastIndexOf('.')) : '.jpg';
      const filename = `yollomi_upscale_${scale}x_${Date.now()}${ext}`;
      const { path: fp, size } = await downloadOutput(url, kwargs.output as string, filename);
      if (data.remainingCredits !== undefined) writeStatus(`Credits remaining: ${data.remainingCredits}`);
      return [{ status: 'saved', file: path.relative('.', fp), size: fmtBytes(size), scale: `${scale}x`, url }];
    } catch {
      return [{ status: 'download-failed', file: '-', size: '-', scale: `${scale}x`, url }];
    }
  },
});
