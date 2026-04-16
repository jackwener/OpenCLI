import { ArgumentError } from '@jackwener/opencli/errors';
import {
  MAYBEAI_DEFAULT_IMAGE_MODEL_PRIORITY,
  type MaybeAiAspectRatio,
  type MaybeAiImageModel,
  type MaybeAiResolution,
} from './profiles.js';

export interface MaybeAiModelRuleSource {
  label: string;
  url?: string;
  confidence: 'official' | 'inferred';
}

export interface MaybeAiImageModelProfile {
  model: MaybeAiImageModel;
  priority: number | null;
  defaultRatio: MaybeAiAspectRatio;
  supportedRatios: MaybeAiAspectRatio[];
  supportedResolutions?: MaybeAiResolution[];
  notes: string[];
  sources: MaybeAiModelRuleSource[];
}

const STANDARD_IMAGE_RATIOS: MaybeAiAspectRatio[] = [
  'auto',
  '21:9',
  '16:9',
  '3:2',
  '4:3',
  '5:4',
  '1:1',
  '4:5',
  '3:4',
  '2:3',
  '9:16',
];

const GEMINI_FLASH_RATIOS: MaybeAiAspectRatio[] = [
  ...STANDARD_IMAGE_RATIOS,
  '4:1',
  '1:4',
  '8:1',
  '1:8',
];

export const MAYBEAI_IMAGE_MODEL_PROFILES: Record<MaybeAiImageModel, MaybeAiImageModelProfile> = {
  'google/gemini-3.1-flash-image-preview': {
    model: 'google/gemini-3.1-flash-image-preview',
    priority: 1,
    defaultRatio: '1:1',
    supportedRatios: GEMINI_FLASH_RATIOS,
    supportedResolutions: ['1K', '2K', '4K'],
    notes: ['默认首选模型；官方 Gemini image config 支持标准比例和 4:1/1:4/8:1/1:8 等扩展比例。'],
    sources: [
      {
        label: 'Google Gemini API image generation ImageConfig',
        url: 'https://ai.google.dev/api/generate-content',
        confidence: 'official',
      },
    ],
  },
  'fal-ai/nano-banana-2/edit': {
    model: 'fal-ai/nano-banana-2/edit',
    priority: 2,
    defaultRatio: '1:1',
    supportedRatios: GEMINI_FLASH_RATIOS,
    supportedResolutions: ['1K', '2K', '4K'],
    notes: ['第二优先级；fal 官方 schema 暴露的 aspect_ratio 与 Gemini Flash 族比例保持一致。'],
    sources: [
      {
        label: 'fal.ai nano-banana-2 edit API schema',
        url: 'https://fal.ai/models/fal-ai/nano-banana-2/edit/api',
        confidence: 'official',
      },
    ],
  },
  'google/gemini-3-pro-image-preview': {
    model: 'google/gemini-3-pro-image-preview',
    priority: 3,
    defaultRatio: '1:1',
    supportedRatios: STANDARD_IMAGE_RATIOS,
    supportedResolutions: ['1K', '2K', '4K'],
    notes: ['第三优先级；用于 Shell 中部分固定为 Pro 的编辑类 app。'],
    sources: [
      {
        label: 'Google Gemini API image generation ImageConfig',
        url: 'https://ai.google.dev/api/generate-content',
        confidence: 'official',
      },
    ],
  },
  'fal-ai/nano-banana-pro/edit': {
    model: 'fal-ai/nano-banana-pro/edit',
    priority: 4,
    defaultRatio: '1:1',
    supportedRatios: STANDARD_IMAGE_RATIOS,
    supportedResolutions: ['1K', '2K', '4K'],
    notes: ['第四优先级；fal 官方 schema 支持电商常用标准比例。'],
    sources: [
      {
        label: 'fal.ai nano-banana-pro edit API schema',
        url: 'https://fal.ai/models/fal-ai/nano-banana-pro/edit/api',
        confidence: 'official',
      },
    ],
  },
  'fal-ai/gpt-image-1.5/edit': {
    model: 'fal-ai/gpt-image-1.5/edit',
    priority: null,
    defaultRatio: '1:1',
    supportedRatios: STANDARD_IMAGE_RATIOS,
    supportedResolutions: ['1K', '2K', '4K'],
    notes: ['Shell 支持模型，但不在 MaybeAI 默认优先级中；比例按 Shell/Fal 常用标准比例保守处理。'],
    sources: [
      {
        label: 'MaybeAI Shell image model option',
        confidence: 'inferred',
      },
    ],
  },
  'fal-ai/qwen-image-edit-2511': {
    model: 'fal-ai/qwen-image-edit-2511',
    priority: null,
    defaultRatio: '1:1',
    supportedRatios: STANDARD_IMAGE_RATIOS,
    supportedResolutions: ['1K', '2K', '4K'],
    notes: ['Shell 支持模型，但不在 MaybeAI 默认优先级中；比例按 Shell/Fal 常用标准比例保守处理。'],
    sources: [
      {
        label: 'MaybeAI Shell image model option',
        confidence: 'inferred',
      },
    ],
  },
};

export function getMaybeAiImageModelProfile(model: MaybeAiImageModel): MaybeAiImageModelProfile {
  return MAYBEAI_IMAGE_MODEL_PROFILES[model];
}

export function listMaybeAiImageModelProfiles(): MaybeAiImageModelProfile[] {
  return Object.values(MAYBEAI_IMAGE_MODEL_PROFILES).sort((left, right) => {
    const leftPriority = left.priority ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = right.priority ?? Number.MAX_SAFE_INTEGER;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return left.model.localeCompare(right.model);
  });
}

export function supportsMaybeAiRatio(model: MaybeAiImageModel, ratio: MaybeAiAspectRatio | undefined): boolean {
  if (!ratio || ratio === 'auto') return true;
  return getMaybeAiImageModelProfile(model).supportedRatios.includes(ratio);
}

export function selectMaybeAiDefaultModelForRatio(ratio: MaybeAiAspectRatio | undefined): MaybeAiImageModel {
  const model = MAYBEAI_DEFAULT_IMAGE_MODEL_PRIORITY.find((candidate) => supportsMaybeAiRatio(candidate, ratio));
  if (!model) {
    throw new ArgumentError(
      `No default image model supports ratio: ${ratio}`,
      `Try one of the supported ratios for default models: ${listMaybeAiImageModelProfiles()
        .filter((profile) => profile.priority !== null)
        .flatMap((profile) => profile.supportedRatios)
        .filter((item, index, list) => list.indexOf(item) === index)
        .join(', ')}`,
    );
  }
  return model;
}

export function assertMaybeAiModelSupportsRatio(model: MaybeAiImageModel, ratio: MaybeAiAspectRatio | undefined): void {
  if (supportsMaybeAiRatio(model, ratio)) return;
  const profile = getMaybeAiImageModelProfile(model);
  throw new ArgumentError(
    `Model ${model} does not support ratio ${ratio}`,
    `Supported ratios for ${model}: ${profile.supportedRatios.join(', ')}`,
  );
}
