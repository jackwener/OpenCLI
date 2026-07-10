import { CliError } from '@jackwener/opencli/errors';
import { DEFAULT_VIDEO_MODEL, VIDEO_MODELS } from './profiles.js';

export const MODEL_PROFILES = [
  {
    model: 'fal-ai/kling-video/v2.6/pro/image-to-video',
    priority: 100,
    supportedRatios: ['9:16', '16:9', '4:3', '3:4', '1:1'],
    recommendedFor: ['video-remake', 'product-ad-video', 'listing-video', 'ugc-ad-video', 'image-to-video'],
  },
  {
    model: 'fal-ai/kling-video/v3/pro/image-to-video',
    priority: 90,
    supportedRatios: ['9:16', '16:9', '4:3', '3:4', '1:1'],
    recommendedFor: ['video-remake', 'product-ad-video', 'listing-video', 'ugc-ad-video', 'image-to-video'],
  },
  {
    model: 'fal-ai/kling-video/o1/reference-to-video',
    priority: 80,
    supportedRatios: ['9:16', '16:9', '4:3', '3:4', '1:1'],
    recommendedFor: ['future-reference-video'],
  },
  {
    model: 'fal-ai/kling-video/o1/standard/reference-to-video',
    priority: 70,
    supportedRatios: ['9:16', '16:9', '4:3', '3:4', '1:1'],
    recommendedFor: ['future-reference-video'],
  },
  {
    model: 'fal-ai/kling-video/o3/pro/reference-to-video',
    priority: 60,
    supportedRatios: ['9:16', '16:9', '4:3', '3:4', '1:1'],
    recommendedFor: ['future-reference-video'],
  },
  {
    model: 'fal-ai/kling-video/o3/standard/image-to-video',
    priority: 50,
    supportedRatios: ['9:16', '16:9', '4:3', '3:4', '1:1'],
    recommendedFor: ['image-to-video'],
  },
] as const;

export function listModelProfiles() {
  return MODEL_PROFILES;
}

export function getModelProfile(model: string) {
  const profile = MODEL_PROFILES.find(item => item.model === model);
  if (!profile) throw new CliError('ARGUMENT', `Invalid model: ${model}`, `Allowed model values: ${VIDEO_MODELS.join(', ')}`);
  return profile;
}

export function selectDefaultModel() {
  return DEFAULT_VIDEO_MODEL;
}
