/**
 * Yollomi AI background generator — POST /api/ai/ai-background-generator
 */
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { log } from '@jackwener/opencli/logger';
import { YOLLOMI_DOMAIN, yollomiPost, downloadOutput, fmtBytes } from './utils.js';
cli({
    site: 'yollomi',
    name: 'background',
    access: 'write',
    description: 'Generate AI background for a product/object image (5 credits)',
    domain: YOLLOMI_DOMAIN,
    strategy: Strategy.COOKIE,
    args: [
        { name: 'image', positional: true, required: true, help: 'Image URL (upload via "opencli yollomi upload" first)' },
        { name: 'prompt', default: '', help: 'Background description (optional)' },
        { name: 'output', default: './yollomi-output', help: 'Output directory' },
        { name: 'no-download', type: 'boolean', default: false, help: 'Only show URL' },
    ],
    columns: ['status', 'file', 'size', 'url'],
    func: async (page, kwargs) => {
        const imageUrl = kwargs.image;
        const prompt = kwargs.prompt;
        log.status('Generating background...');
        const data = await yollomiPost(page, '/api/ai/ai-background-generator', {
            images: [imageUrl],
            prompt: prompt || undefined,
            aspect_ratio: '1:1',
        });
        const url = data.image || (data.images?.[0]);
        if (!url)
            throw new CliError('EMPTY_RESPONSE', 'No result', 'Try a different image');
        if (kwargs['no-download'])
            return [{ status: 'generated', file: '-', size: '-', url }];
        try {
            const filename = `yollomi_bg_${Date.now()}.png`;
            const { path: fp, size } = await downloadOutput(url, kwargs.output, filename);
            return [{ status: 'saved', file: path.relative('.', fp), size: fmtBytes(size), url }];
        }
        catch {
            return [{ status: 'download-failed', file: '-', size: '-', url }];
        }
    },
});
