/**
 * Yollomi text-to-image / image-to-image generation.
 *
 * Uses per-model routes exactly like the frontend:
 *   POST /api/ai/z-image-turbo  { prompt, width, height, ... }
 *   POST /api/ai/nano-banana    { prompt, aspect_ratio, ... }
 *   POST /api/ai/flux-2-pro     { prompt, aspectRatio, imageUrl?, ... }
 */

import * as path from 'node:path';
import chalk from 'chalk';
import { cli, Strategy } from '../../src/registry.js';
import { CliError } from '../../src/errors.js';
import { YOLLOMI_DOMAIN, yollomiPost, resolveImageInput, downloadOutput, fmtBytes, MODEL_ROUTES } from './utils.js';

function getDimensions(ratio: string): { width: number; height: number } {
  const map: Record<string, [number, number]> = {
    '1:1': [1024, 1024], '16:9': [1344, 768], '9:16': [768, 1344],
    '4:3': [1152, 896], '3:4': [896, 1152],
  };
  const [w, h] = map[ratio] || [1024, 1024];
  return { width: w, height: h };
}

cli({
  site: 'yollomi',
  name: 'generate',
  description: 'Generate images with AI (text-to-image or image-to-image)',
  domain: YOLLOMI_DOMAIN,
  strategy: Strategy.COOKIE,
  args: [
    { name: 'prompt', positional: true, required: true, help: 'Text prompt describing the image' },
    { name: 'model', default: 'z-image-turbo', help: 'Model ID (z-image-turbo, flux-schnell, nano-banana, flux-2-pro, ...)' },
    { name: 'ratio', default: '1:1', choices: ['1:1', '16:9', '9:16', '4:3', '3:4'], help: 'Aspect ratio' },
    { name: 'image', help: 'Input image URL for image-to-image (upload via "opencli yollomi upload" first)' },
    { name: 'output', default: './yollomi-output', help: 'Output directory' },
    { name: 'no-download', type: 'boolean', default: false, help: 'Only show URLs, skip download' },
  ],
  columns: ['index', 'status', 'file', 'size', 'url'],
  func: async (page, kwargs) => {
    const prompt = kwargs.prompt as string;
    const modelId = kwargs.model as string;
    const ratio = kwargs.ratio as string;

    const apiPath = MODEL_ROUTES[modelId];
    if (!apiPath) throw new CliError('INVALID_MODEL', `Unknown model: ${modelId}`, 'Run "opencli yollomi models --type image" to see available models');

    let body: Record<string, unknown>;

    if (modelId === 'z-image-turbo') {
      const { width, height } = getDimensions(ratio);
      body = { prompt, width, height, output_format: 'jpg', output_quality: 85, guidance_scale: 0, num_inference_steps: 8 };
    } else if (modelId === 'flux-2-pro') {
      body = { prompt, aspectRatio: ratio, outputNumber: 1 };
      if (kwargs.image) body.imageUrl = kwargs.image as string;
    } else if (modelId === 'flux-kontext-pro') {
      body = { prompt, output_format: 'jpg' };
      if (kwargs.image) body.imageUrl = kwargs.image as string;
      if (ratio !== '1:1') body.aspect_ratio = ratio;
    } else {
      body = { prompt, aspect_ratio: ratio };
      if (kwargs.image) body.imageUrl = kwargs.image as string;
    }

    process.stderr.write(chalk.dim(`Generating with ${modelId}...\n`));
    const data = await yollomiPost(page, apiPath, body);

    const images: string[] = data.images || (data.image ? [data.image] : []);
    if (!images.length) throw new CliError('EMPTY_RESPONSE', 'No images returned', 'Try a different prompt or model');

    const noDownload = kwargs['no-download'] as boolean;
    const outputDir = kwargs.output as string;
    const results: any[] = [];

    for (let i = 0; i < images.length; i++) {
      const url = images[i];
      if (noDownload) {
        results.push({ index: i + 1, status: 'generated', file: '-', size: '-', url });
        continue;
      }
      try {
        const urlPath = (() => { try { return new URL(url).pathname; } catch { return url; } })();
        const ext = urlPath.endsWith('.png') || urlPath.endsWith('.webp') ? urlPath.slice(urlPath.lastIndexOf('.')) : '.jpg';
        const filename = `yollomi_${modelId}_${Date.now()}_${i + 1}${ext}`;
        const { path: fp, size } = await downloadOutput(url, outputDir, filename);
        results.push({ index: i + 1, status: 'saved', file: path.relative('.', fp), size: fmtBytes(size), url });
      } catch {
        results.push({ index: i + 1, status: 'download-failed', file: '-', size: '-', url });
      }
    }

    if (data.remainingCredits !== undefined) process.stderr.write(chalk.dim(`Credits remaining: ${data.remainingCredits}\n`));
    return results;
  },
});
