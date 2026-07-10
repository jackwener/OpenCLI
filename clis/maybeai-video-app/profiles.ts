import { CliError } from '@jackwener/opencli/errors';
import { CATEGORIES, COUNTRIES_AND_REGIONS, PLATFORMS } from '../maybeai-image-app/profiles.js';

export const VIDEO_ASPECT_RATIOS = ['9:16', '16:9', '4:3', '3:4', '1:1'] as const;
export const VIDEO_DURATIONS = ['5', '10', '15', '20', '30', '45', '60'] as const;
export const VIDEO_STYLES = ['remake', 'product-demo', 'listing', 'ugc', 'lifestyle', 'tutorial', 'showcase'] as const;
export const VIDEO_MODELS = [
  'fal-ai/kling-video/v2.6/pro/image-to-video',
  'fal-ai/kling-video/v3/pro/image-to-video',
  'fal-ai/kling-video/o1/reference-to-video',
  'fal-ai/kling-video/o1/standard/reference-to-video',
  'fal-ai/kling-video/o3/pro/reference-to-video',
  'fal-ai/kling-video/o3/standard/image-to-video',
] as const;

export const DEFAULT_VIDEO_MODEL = 'fal-ai/kling-video/v2.6/pro/image-to-video' as const;

export const OPTION_VALUES = {
  platform: [...PLATFORMS],
  country: [...COUNTRIES_AND_REGIONS],
  category: [...CATEGORIES],
  ratio: [...VIDEO_ASPECT_RATIOS],
  duration: [...VIDEO_DURATIONS],
  style: [...VIDEO_STYLES],
  model: [...VIDEO_MODELS],
} as const;

export function getOptions(kind?: string): Record<string, readonly string[]> {
  if (kind === undefined) return OPTION_VALUES;
  if (!(kind in OPTION_VALUES)) {
    throw new CliError('ARGUMENT', `Invalid option kind: ${kind}`, `Allowed option kinds: ${Object.keys(OPTION_VALUES).join(', ')}`);
  }
  return { [kind]: OPTION_VALUES[kind as keyof typeof OPTION_VALUES] };
}

export function validateOption(kind: keyof typeof OPTION_VALUES, value: unknown, fieldName: string): void {
  const allowed = OPTION_VALUES[kind];
  const values = Array.isArray(value) ? value : [value];
  const invalid = values.filter(item => item !== undefined && item !== null && item !== '' && (typeof item !== 'string' || !allowed.includes(item as never)));
  if (invalid.length > 0) {
    throw new CliError('ARGUMENT', `Invalid ${fieldName}: ${invalid.join(', ')}`, `Allowed ${fieldName} values: ${allowed.join(', ')}`);
  }
}
