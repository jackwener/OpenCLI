/**
 * Yollomi image editing — POST /api/ai/qwen-image-edit
 * Matches frontend workspace-generator.tsx for qwen-image-edit model.
 */
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { CliError } from '@jackwener/opencli/errors';
import { log } from '@jackwener/opencli/logger';
import { YOLLOMI_DOMAIN, yollomiPost, downloadOutput, fmtBytes } from './utils.js';
cli({
    site: 'yollomi',
    name: 'edit',
    access: 'write',
    description: 'Edit images with AI text prompts (Qwen image edit)',
    domain: YOLLOMI_DOMAIN,
    strategy: Strategy.COOKIE,
    args: [
        { name: 'image', positional: true, required: true, help: 'Input image URL (upload via "opencli yollomi upload" first)' },
        { name: 'prompt', positional: true, required: true, help: 'Editing instruction (e.g. "Make it look vintage")' },
        { name: 'model', default: 'qwen-image-edit', choices: ['qwen-image-edit', 'qwen-image-edit-plus'], help: 'Edit model' },
        { name: 'output', default: './yollomi-output', help: 'Output directory' },
        { name: 'no-download', type: 'boolean', default: false, help: 'Only show URL' },
    ],
    columns: ['status', 'file', 'size', 'credits', 'url'],
    func: async (page, kwargs) => {
        const imageInput = kwargs.image;
        const prompt = kwargs.prompt;
        const modelId = kwargs.model;
        let body;
        if (modelId === 'qwen-image-edit-plus') {
            body = { prompt, images: [imageInput] };
        }
        else {
            body = { image: imageInput, prompt, go_fast: true, output_format: 'png' };
        }
        const apiPath = modelId === 'qwen-image-edit-plus' ? '/api/ai/qwen-image-edit-plus' : '/api/ai/qwen-image-edit';
        log.status(`Editing with ${modelId}...`);
        const data = await yollomiPost(page, apiPath, body);
        const images = data.images || (data.image ? [data.image] : []);
        if (!images.length)
            throw new CliError('EMPTY_RESPONSE', 'No result', 'Try a different prompt');
        const credits = data.remainingCredits;
        const url = images[0];
        if (kwargs['no-download'])
            return [{ status: 'edited', file: '-', size: '-', credits: credits ?? '-', url }];
        try {
            const filename = `yollomi_edit_${Date.now()}.png`;
            const { path: fp, size } = await downloadOutput(url, kwargs.output, filename);
            if (credits !== undefined)
                log.status(`Credits remaining: ${credits}`);
            return [{ status: 'saved', file: path.relative('.', fp), size: fmtBytes(size), credits: credits ?? '-', url }];
        }
        catch {
            return [{ status: 'download-failed', file: '-', size: '-', credits: credits ?? '-', url }];
        }
    },
});
