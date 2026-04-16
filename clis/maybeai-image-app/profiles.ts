import { ArgumentError } from '@jackwener/opencli/errors';

export const MAYBEAI_PLATFORMS = [
  'Amazon',
  'Temu',
  'TikTokShop',
  'Shopee',
  'Lazada',
  'Hacoo',
  'XiaoHongShu',
  'Instagram',
  'Etsy',
  'Taobao',
  'Pinduoduo',
] as const;

export type MaybeAiPlatform = typeof MAYBEAI_PLATFORMS[number];

export const MAYBEAI_COUNTRIES_AND_REGIONS = [
  'China',
  'Malaysia',
  'Korea',
  'Southeast Asia',
  'South America',
  'Indonesia',
  'Thailand',
  'Central Europe',
  'Western Europe',
  'Northern Europe',
  'West Asia',
  'North America',
  'Africa',
  'Japan',
  'Russia',
] as const;

export type MaybeAiCountryOrRegion = typeof MAYBEAI_COUNTRIES_AND_REGIONS[number];

export const MAYBEAI_ANGLES = [
  'Frontal',
  'Lateral',
  'Posterior',
  'Three-Quarter',
  'Top-Down',
  'Macro Detail',
] as const;

export type MaybeAiAngle = typeof MAYBEAI_ANGLES[number];

export const MAYBEAI_CATEGORIES = [
  'Bags & Luggage',
  'Beauty & Personal Care',
  "Children's Clothing",
  'Home Decor',
  'Home Textiles',
  "Men's Clothing",
  "Men's Shoes",
  "Women's Clothing",
  "Women's Shoes",
  'Accessories',
  'Electronics',
  'Toys',
  'Furniture & Home Improvement',
  'Appliances & Digital',
  'Sports & Outdoors',
  'Maternity & Trendy Toys',
  'Cleaning & Pets',
  'Automotive & Travel',
  'Food & Fresh',
  'Office & Stationery',
  'Books & Flowers',
  'Watches & Jewelry',
] as const;

export type MaybeAiCategory = typeof MAYBEAI_CATEGORIES[number];

export const MAYBEAI_ASPECT_RATIOS = [
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
  '4:1',
  '1:4',
  '8:1',
  '1:8',
] as const;

export type MaybeAiAspectRatio = typeof MAYBEAI_ASPECT_RATIOS[number];

export const MAYBEAI_RESOLUTIONS = ['1K', '2K', '4K'] as const;

export type MaybeAiResolution = typeof MAYBEAI_RESOLUTIONS[number];

export const MAYBEAI_IMAGE_MODELS = [
  'google/gemini-3.1-flash-image-preview',
  'fal-ai/nano-banana-2/edit',
  'google/gemini-3-pro-image-preview',
  'fal-ai/nano-banana-pro/edit',
  'fal-ai/gpt-image-1.5/edit',
  'fal-ai/qwen-image-edit-2511',
] as const;

export const MAYBEAI_DEFAULT_IMAGE_MODEL_PRIORITY = [
  'google/gemini-3.1-flash-image-preview',
  'fal-ai/nano-banana-2/edit',
  'google/gemini-3-pro-image-preview',
  'fal-ai/nano-banana-pro/edit',
] as const;

export type MaybeAiImageModel = typeof MAYBEAI_IMAGE_MODELS[number];

export const MAYBEAI_DEFAULT_IMAGE_MODEL: MaybeAiImageModel = 'google/gemini-3.1-flash-image-preview';

export const MAYBEAI_IMAGE_KINDS = [
  'main',
  'scene',
  'detail',
  'multi-angle',
  'model',
  'social',
  'story',
  'edit',
] as const;

export type MaybeAiImageKind = typeof MAYBEAI_IMAGE_KINDS[number];

export type MaybeAiOptionKind = 'platform' | 'country' | 'angle' | 'category' | 'ratio' | 'resolution' | 'model' | 'image-kind';

const OPTION_VALUES: Record<MaybeAiOptionKind, readonly string[]> = {
  platform: MAYBEAI_PLATFORMS,
  country: MAYBEAI_COUNTRIES_AND_REGIONS,
  angle: MAYBEAI_ANGLES,
  category: MAYBEAI_CATEGORIES,
  ratio: MAYBEAI_ASPECT_RATIOS,
  resolution: MAYBEAI_RESOLUTIONS,
  model: MAYBEAI_IMAGE_MODELS,
  'image-kind': MAYBEAI_IMAGE_KINDS,
};

export function getMaybeAiOptions(kind?: MaybeAiOptionKind): Record<string, readonly string[]> {
  if (kind) return { [kind]: OPTION_VALUES[kind] };
  return OPTION_VALUES;
}

export function validateMaybeAiOption(kind: MaybeAiOptionKind, value: unknown, fieldName: string): void {
  const allowed = OPTION_VALUES[kind];
  const values = Array.isArray(value) ? value : [value];
  const invalid = values
    .filter((item) => item !== undefined && item !== null && item !== '')
    .filter((item) => typeof item !== 'string' || !allowed.includes(item));

  if (invalid.length > 0) {
    throw new ArgumentError(
      `Invalid ${fieldName}: ${invalid.join(', ')}`,
      `Allowed ${fieldName} values: ${allowed.join(', ')}`,
    );
  }
}
