import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { cli, Strategy } from '@jackwener/opencli/registry';
import { ArgumentError, CommandExecutionError, EmptyResultError } from '@jackwener/opencli/errors';
import { saveBase64ToFile } from '@jackwener/opencli/utils';
import {
  AISTUDIO_DOMAIN,
  applyAIStudioSettings,
  createAIStudioDeadline,
  exportAIStudioImages,
  readAIStudioModels,
  parseAIStudioJsonObject,
  parseAIStudioStringList,
  requirePositiveInteger,
  sendAIStudioMessage,
  startNewAIStudioChat,
  uploadAIStudioImages,
  validateAIStudioImageAsset,
  waitForAIStudioResponse,
} from './utils.js';

function resolveOutputDir(value) {
  const raw = String(value || '').trim();
  if (!raw) return path.join(os.homedir(), 'Pictures', 'aistudio');
  if (raw === '~') return os.homedir();
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return path.join(os.homedir(), raw.slice(2));
  return path.resolve(raw);
}

function extensionFromMime(mimeType) {
  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('gif')) return '.gif';
  return '.png';
}

function nextAvailablePath(directory, baseName, extension) {
  let candidate = path.join(directory, `${baseName}${extension}`);
  for (let suffix = 2; fs.existsSync(candidate); suffix += 1) {
    candidate = path.join(directory, `${baseName}_${suffix}${extension}`);
  }
  return candidate;
}

export function requireCompleteAIStudioImageExport(images, assets, responseUrl) {
  const expectedAssetCount = new Set(
    images.map((image) => String(image?.src || '')).filter(Boolean),
  ).size;
  if (assets.length < expectedAssetCount) {
    throw new CommandExecutionError(
      `AI Studio returned ${expectedAssetCount} image asset(s), but only ${assets.length} could be exported`,
      `Open ${responseUrl} and download the missing image(s) manually.`,
    );
  }
  if (!assets.length) {
    throw new CommandExecutionError(
      'AI Studio generated an image, but the adapter could not export its pixels',
      `Open ${responseUrl} and download the image manually.`,
    );
  }
  return assets;
}

export const imageCommand = cli({
  site: 'aistudio',
  name: 'image',
  access: 'write',
  description: 'Generate images with Google AI Studio image models and save them locally',
  domain: AISTUDIO_DOMAIN,
  strategy: Strategy.COOKIE,
  browser: true,
  siteSession: 'persistent',
  navigateBefore: false,
  defaultFormat: 'plain',
  args: [
    { name: 'prompt', positional: true, required: true, help: 'Image generation prompt' },
    { name: 'image', type: 'string', help: 'Local reference image path for image-to-image generation or editing' },
    {
      name: 'model',
      type: 'string',
      default: '',
      help: 'Image model id or unique name (default: first available image model)',
    },
    { name: 'aspect-ratio', type: 'string', default: '1:1', help: 'Aspect ratio shown by the model, e.g. 1:1, 16:9, 9:16' },
    { name: 'resolution', type: 'string', help: 'Resolution shown by the model (default: 1K)' },
    { name: 'output', type: 'string', default: 'images', choices: ['images', 'images-text'], help: 'Return images only or images with text' },
    { name: 'thinking', type: 'string', help: 'Thinking Level shown by the selected model (omitted = leave unchanged)' },
    { name: 'temperature', type: 'number', help: 'Sampling temperature within the selected model UI range (only when exposed by the model)' },
    { name: 'top-p', type: 'number', help: 'Top P within the selected model UI range (only when exposed by the model)' },
    { name: 'max-output-tokens', type: 'int', help: 'Maximum output tokens within the selected model UI range' },
    { name: 'system-instruction', type: 'string', help: 'Optional system instruction for generation' },
    { name: 'structured-output', type: 'bool', help: 'Enable or disable structured outputs (omit = leave unchanged)' },
    { name: 'code-execution', type: 'bool', help: 'Enable or disable code execution (omit = leave unchanged)' },
    { name: 'function-calling', type: 'bool', help: 'Enable or disable function calling (omit = leave unchanged)' },
    { name: 'google-search', type: 'bool', help: 'Enable or disable Grounding with Google Search (omit = leave unchanged)' },
    { name: 'google-maps', type: 'bool', help: 'Enable or disable Grounding with Google Maps (omit = leave unchanged)' },
    { name: 'url-context', type: 'bool', help: 'Enable or disable URL context (omit = leave unchanged)' },
    { name: 'media-resolution', type: 'string', help: 'Media resolution shown by the selected model, e.g. Default or High' },
    { name: 'stop-sequences', type: 'string', help: 'Stop sequences as a comma-separated list or JSON string array' },
    { name: 'safety-settings', type: 'string', help: 'Safety thresholds as a JSON object, e.g. {"Harassment":"Block some"}' },
    { name: 'output-dir', type: 'string', help: 'Output directory (default: ~/Pictures/aistudio)' },
    { name: 'skip-download', type: 'bool', default: false, help: 'Do not download; return the AI Studio prompt link only' },
    { name: 'timeout', type: 'int', default: 240, help: 'Maximum generation time in seconds (default: 240)' },
  ],
  columns: ['status', 'file', 'model', 'width', 'height', 'link'],
  func: async (page, kwargs) => {
    const timeout = requirePositiveInteger(kwargs.timeout, '--timeout');
    const deadline = createAIStudioDeadline(timeout);
    if (kwargs['max-output-tokens'] !== undefined) {
      requirePositiveInteger(kwargs['max-output-tokens'], '--max-output-tokens');
    }
    if (!String(kwargs.prompt || '').trim()) throw new ArgumentError('prompt must not be empty');
    await startNewAIStudioChat(page, { deadline });
    let modelArg = String(kwargs.model || '').trim();
    if (!modelArg) {
      const imageModels = await readAIStudioModels(page, 'image', { deadline });
      const first = imageModels[0];
      if (!first) {
        throw new EmptyResultError('aistudio image', 'No image models are available for the current account');
      }
      modelArg = first.model;
    }
    const settings = await applyAIStudioSettings(page, {
      model: modelArg,
      requiredCategory: 'image',
      outputMode: kwargs.output,
      aspectRatio: kwargs['aspect-ratio'],
      resolution: kwargs.resolution || '1K',
      skipResolutionIfMissing: kwargs.resolution === undefined,
      thinking: kwargs.thinking,
      temperature: kwargs.temperature,
      topP: kwargs['top-p'],
      maxOutputTokens: kwargs['max-output-tokens'],
      systemInstruction: kwargs['system-instruction'],
      structuredOutput: kwargs['structured-output'],
      codeExecution: kwargs['code-execution'],
      functionCalling: kwargs['function-calling'],
      googleSearch: kwargs['google-search'],
      googleMaps: kwargs['google-maps'],
      urlContext: kwargs['url-context'],
      mediaResolution: kwargs['media-resolution'],
      stopSequences: parseAIStudioStringList(kwargs['stop-sequences'], '--stop-sequences'),
      safetySettings: parseAIStudioJsonObject(kwargs['safety-settings'], '--safety-settings'),
      deadline,
    });

    if (kwargs.image) await uploadAIStudioImages(page, [kwargs.image], { deadline });

    const submission = await sendAIStudioMessage(page, kwargs.prompt, { deadline });
    const response = await waitForAIStudioResponse(page, submission, timeout, { deadline });
    const images = response.images || [];
    if (!images.length) {
      throw new EmptyResultError(
        'aistudio image',
        response.text
          ? `AI Studio returned text but no image: ${response.text.slice(0, 240)}`
          : 'AI Studio completed without a generated image.',
      );
    }

    if (kwargs['skip-download']) {
      return images.map((image) => ({
        status: 'generated',
        file: null,
        model: settings.model,
        width: image.width,
        height: image.height,
        link: response.url,
      }));
    }

    const directAssets = images.flatMap((image) => {
      const match = String(image.src || '').match(/^data:([^;]+);base64,(.+)$/s);
      if (!match) return [];
      return [{
        url: image.src,
        dataUrl: image.src,
        mimeType: match[1],
        width: image.width,
        height: image.height,
      }];
    });
    const remoteUrls = images.map((image) => image.src).filter((src) => src && !String(src).startsWith('data:'));
    const exportedAssets = remoteUrls.length ? await exportAIStudioImages(page, remoteUrls, { deadline }) : [];
    const validatedAssets = [...directAssets, ...exportedAssets].flatMap((asset) => {
      const validation = validateAIStudioImageAsset(asset);
      return validation.ok
        ? [{ ...asset, bytes: validation.bytes, width: validation.width, height: validation.height }]
        : [];
    });
    const assets = requireCompleteAIStudioImageExport(images, validatedAssets, response.url);
    const outputDir = resolveOutputDir(kwargs['output-dir']);
    await fs.promises.mkdir(outputDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    const rows = [];
    for (let index = 0; index < assets.length; index += 1) {
      const asset = assets[index];
      const extension = extensionFromMime(asset.mimeType);
      const suffix = assets.length > 1 ? `_${index + 1}` : '';
      const file = nextAvailablePath(outputDir, `aistudio_${timestamp}${suffix}`, extension);
      const base64 = String(asset.dataUrl).replace(/^data:[^;]+;base64,/, '');
      await saveBase64ToFile(base64, file);
      const stat = await fs.promises.stat(file);
      if (!stat.size) {
        throw new CommandExecutionError(
          'AI Studio image export produced an empty file',
          `The browser returned image data for ${asset.url || 'an unknown asset'}, but ${file} is empty.`,
        );
      }
      rows.push({
        status: 'saved',
        file,
        model: settings.model,
        width: asset.width,
        height: asset.height,
        link: response.url,
      });
    }
    return rows;
  },
});
