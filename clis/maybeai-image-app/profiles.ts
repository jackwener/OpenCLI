import { CliError } from '@jackwener/opencli/errors';

export const PLATFORMS = [
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

export const COUNTRIES_AND_REGIONS = [
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

export const ANGLES = ['Frontal', 'Lateral', 'Posterior', 'Three-Quarter', 'Top-Down', 'Macro Detail'] as const;

export const CATEGORIES = [
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

export const ASPECT_RATIOS = ['auto', '21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16', '4:1', '1:4', '8:1', '1:8'] as const;
export const RESOLUTIONS = ['1K', '2K', '4K'] as const;
export const IMAGE_GROUP_TYPES = ['Listing', 'Detail'] as const;
export const IMAGE_MODELS = [
  'google/gemini-3.1-flash-image-preview',
  'fal-ai/nano-banana-2/edit',
  'google/gemini-3-pro-image-preview',
  'fal-ai/nano-banana-pro/edit',
  'fal-ai/gpt-image-1.5/edit',
  'fal-ai/qwen-image-edit-2511',
] as const;

export const DEFAULT_IMAGE_MODEL_PRIORITY = [
  'google/gemini-3.1-flash-image-preview',
  'fal-ai/nano-banana-2/edit',
  'google/gemini-3-pro-image-preview',
  'fal-ai/nano-banana-pro/edit',
] as const;

export const DEFAULT_IMAGE_MODEL = 'google/gemini-3.1-flash-image-preview' as const;
export const IMAGE_KINDS = ['main', 'scene', 'detail', 'multi-angle', 'model', 'social', 'story', 'edit'] as const;

export const OPTION_VALUES = {
  platform: [...PLATFORMS],
  country: [...COUNTRIES_AND_REGIONS],
  angle: [...ANGLES],
  category: [...CATEGORIES],
  ratio: [...ASPECT_RATIOS],
  resolution: [...RESOLUTIONS],
  'image-group-type': [...IMAGE_GROUP_TYPES],
  model: [...IMAGE_MODELS],
  'image-kind': [...IMAGE_KINDS],
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
