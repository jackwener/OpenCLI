/**
 * Yollomi video generation — POST /api/ai/video
 * Matches the frontend video-generator.tsx request format exactly.
 */

import * as path from 'node:path';
import chalk from 'chalk';
import { cli, Strategy } from '../../src/registry.js';
import { CliError } from '../../src/errors.js';
import { YOLLOMI_DOMAIN, yollomiPost, downloadOutput, fmtBytes } from './utils.js';

cli({
  site: 'yollomi',
  name: 'video',
  description: 'Generate videos with AI (text-to-video or image-to-video)',
  domain: YOLLOMI_DOMAIN,
  strategy: Strategy.COOKIE,
  args: [
    { name: 'prompt', positional: true, required: true, help: 'Text prompt describing the video' },
    { name: 'model', default: 'kling-2-1', help: 'Model (kling-2-1, openai-sora-2, google-veo-3-1, wan-2-5-t2v, ...)' },
    { name: 'image', help: 'Input image URL for image-to-video' },
    { name: 'ratio', default: '16:9', choices: ['1:1', '16:9', '9:16', '4:3', '3:4'], help: 'Aspect ratio' },
    { name: 'output', default: './yollomi-output', help: 'Output directory' },
    { name: 'no-download', type: 'boolean', default: false, help: 'Only show URL, skip download' },
  ],
  columns: ['status', 'file', 'size', 'credits', 'url'],
  func: async (page, kwargs) => {
    const prompt = kwargs.prompt as string;
    const modelId = kwargs.model as string;

    const inputs: Record<string, unknown> = {
      aspect_ratio: kwargs.ratio as string,
    };
    if (kwargs.image) inputs.image = kwargs.image as string;

    const body = { modelId, prompt, inputs };

    process.stderr.write(chalk.dim(`Generating video with ${modelId} (may take a while)...\n`));
    const data = await yollomiPost(page, '/api/ai/video', body);

    const videoUrl: string = data.video || '';
    if (!videoUrl) throw new CliError('EMPTY_RESPONSE', 'No video returned', 'Try a different prompt or model');

    const credits = data.remainingCredits;
    const noDownload = kwargs['no-download'] as boolean;
    const outputDir = kwargs.output as string;

    if (noDownload) {
      return [{ status: 'generated', file: '-', size: '-', credits: credits ?? '-', url: videoUrl }];
    }

    try {
      const filename = `yollomi_${modelId}_${Date.now()}.mp4`;
      const { path: fp, size } = await downloadOutput(videoUrl, outputDir, filename);
      if (credits !== undefined) process.stderr.write(chalk.dim(`Credits remaining: ${credits}\n`));
      return [{ status: 'saved', file: path.relative('.', fp), size: fmtBytes(size), credits: credits ?? '-', url: videoUrl }];
    } catch {
      return [{ status: 'download-failed', file: '-', size: '-', credits: credits ?? '-', url: videoUrl }];
    }
  },
});
