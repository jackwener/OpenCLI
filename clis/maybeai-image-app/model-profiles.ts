import { CliError } from '@jackwener/opencli/errors';
import { DEFAULT_IMAGE_MODEL_PRIORITY } from './profiles.js';

const STANDARD_IMAGE_RATIOS = ['auto', '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16'] as const;
const GEMINI_FLASH_RATIOS = [...STANDARD_IMAGE_RATIOS, '4:1', '1:4', '8:1', '1:8'] as const;

export const IMAGE_MODEL_PROFILES = {
  'google/gemini-3.1-flash-image-preview': {
    model: 'google/gemini-3.1-flash-image-preview',
    priority: 1,
    defaultRatio: '1:1',
    supportedRatios: [...GEMINI_FLASH_RATIOS],
    supportedResolutions: ['1K', '2K', '4K'],
    notes: ['默认首选模型；支持标准比例和 4:1/1:4/8:1/1:8 扩展比例。'],
    sources: [{ label: 'Google Gemini API image generation ImageConfig', url: 'https://ai.google.dev/api/generate-content', confidence: 'official' }],
  },
  'fal-ai/nano-banana-2/edit': {
    model: 'fal-ai/nano-banana-2/edit',
    priority: 2,
    defaultRatio: '1:1',
    supportedRatios: [...GEMINI_FLASH_RATIOS],
    supportedResolutions: ['1K', '2K', '4K'],
    notes: ['第二优先级；比例能力按官方 schema 暴露能力配置。'],
    sources: [{ label: 'fal.ai nano-banana-2 edit API schema', url: 'https://fal.ai/models/fal-ai/nano-banana-2/edit/api', confidence: 'official' }],
  },
  'google/gemini-3-pro-image-preview': {
    model: 'google/gemini-3-pro-image-preview',
    priority: 3,
    defaultRatio: '1:1',
    supportedRatios: [...STANDARD_IMAGE_RATIOS],
    supportedResolutions: ['1K', '2K', '4K'],
    notes: ['第三优先级；用于部分固定为 Pro 的编辑类 app。'],
    sources: [{ label: 'Google Gemini API image generation ImageConfig', url: 'https://ai.google.dev/api/generate-content', confidence: 'official' }],
  },
  'fal-ai/nano-banana-pro/edit': {
    model: 'fal-ai/nano-banana-pro/edit',
    priority: 4,
    defaultRatio: '1:1',
    supportedRatios: [...STANDARD_IMAGE_RATIOS],
    supportedResolutions: ['1K', '2K', '4K'],
    notes: ['第四优先级；支持电商常用标准比例。'],
    sources: [{ label: 'fal.ai nano-banana-pro edit API schema', url: 'https://fal.ai/models/fal-ai/nano-banana-pro/edit/api', confidence: 'official' }],
  },
  'fal-ai/gpt-image-1.5/edit': {
    model: 'fal-ai/gpt-image-1.5/edit',
    priority: null,
    defaultRatio: '1:1',
    supportedRatios: [...STANDARD_IMAGE_RATIOS],
    supportedResolutions: ['1K', '2K', '4K'],
    notes: ['Shell 支持模型，但不在默认优先级中；比例按常用标准比例保守处理。'],
    sources: [{ label: 'MaybeAI Shell image model option', confidence: 'inferred' }],
  },
  'fal-ai/qwen-image-edit-2511': {
    model: 'fal-ai/qwen-image-edit-2511',
    priority: null,
    defaultRatio: '1:1',
    supportedRatios: [...STANDARD_IMAGE_RATIOS],
    supportedResolutions: ['1K', '2K', '4K'],
    notes: ['Shell 支持模型，但不在默认优先级中；比例按常用标准比例保守处理。'],
    sources: [{ label: 'MaybeAI Shell image model option', confidence: 'inferred' }],
  },
} as const;

export function getModelProfile(model: string) {
  const profile = IMAGE_MODEL_PROFILES[model as keyof typeof IMAGE_MODEL_PROFILES];
  if (!profile) {
    throw new CliError('ARGUMENT', `Invalid model: ${model}`, `Allowed model values: ${Object.keys(IMAGE_MODEL_PROFILES).join(', ')}`);
  }
  return profile;
}

export function listModelProfiles() {
  return Object.values(IMAGE_MODEL_PROFILES).sort((left, right) => {
    const leftPriority = left.priority ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = right.priority ?? Number.MAX_SAFE_INTEGER;
    return leftPriority - rightPriority || left.model.localeCompare(right.model);
  });
}

export function supportsRatio(model: string, ratio?: string): boolean {
  if (!ratio || ratio === 'auto') return true;
  return getModelProfile(model).supportedRatios.includes(ratio as never);
}

export function selectDefaultModelForRatio(ratio?: string): string {
  for (const model of DEFAULT_IMAGE_MODEL_PRIORITY) {
    if (supportsRatio(model, ratio)) return model;
  }
  const supported = [...new Set(listModelProfiles().filter(profile => profile.priority !== null).flatMap(profile => profile.supportedRatios))].sort();
  throw new CliError('ARGUMENT', `No default image model supports ratio: ${ratio}`, `Try one of these ratios: ${supported.join(', ')}`);
}

export function assertModelSupportsRatio(model: string, ratio?: string): void {
  if (supportsRatio(model, ratio)) return;
  const profile = getModelProfile(model);
  throw new CliError('ARGUMENT', `Model ${model} does not support ratio ${ratio}`, `Supported ratios for ${model}: ${profile.supportedRatios.join(', ')}`);
}
