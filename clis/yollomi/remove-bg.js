/**
 * Yollomi background removal — POST /api/ai/remove-bg (free, 0 credits)
 */
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { log } from '@jackwener/opencli/logger';
import { YOLLOMI_DOMAIN, yollomiPost, downloadOutput, fmtBytes } from './utils.js';
cli({
    site: 'yollomi',
    name: 'remove-bg',
    access: 'write',
    description: 'Remove image background with AI (free)',
    domain: YOLLOMI_DOMAIN,
    strategy: Strategy.COOKIE,
    args: [
        { name: 'image', positional: true, required: true, help: 'Image URL to remove background from' },
        { name: 'output', default: './yollomi-output', help: 'Output directory' },
        { name: 'no-download', type: 'boolean', default: false, help: 'Only show URL' },
    ],
    columns: ['status', 'file', 'size', 'url'],
    func: async (page, kwargs) => {
        log.status('Removing background...');
        const data = await yollomiPost(page, '/api/ai/remove-bg', { imageUrl: kwargs.image });
        const url = data.image || (data.images?.[0]);
        if (!url)
            throw new CliError('EMPTY_RESPONSE', 'No result', 'Check the input image URL');
        if (kwargs['no-download'])
            return [{ status: 'processed', file: '-', size: '-', url }];
        try {
            const filename = `yollomi_nobg_${Date.now()}.png`;
            const { path: fp, size } = await downloadOutput(url, kwargs.output, filename);
            return [{ status: 'saved', file: path.relative('.', fp), size: fmtBytes(size), url }];
        }
        catch {
            return [{ status: 'download-failed', file: '-', size: '-', url }];
        }
    },
});
