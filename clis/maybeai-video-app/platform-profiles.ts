import { CliError } from '@jackwener/opencli/errors';
import { PLATFORMS } from '../maybeai-image-app/profiles.js';

type AppRatioMap = Record<'video-remake' | 'product-ad-video' | 'listing-video' | 'ugc-ad-video' | 'image-to-video', string>;

const SOCIAL_PLATFORMS = new Set(['TikTokShop', 'Instagram', 'XiaoHongShu']);
const LISTING_FIRST_PLATFORMS = new Set(['Amazon', 'Temu', 'Shopee', 'Lazada', 'Etsy', 'Taobao', 'Pinduoduo']);

function createRatios(platform: string): AppRatioMap {
  const socialRatio = SOCIAL_PLATFORMS.has(platform) ? '9:16' : '1:1';
  return {
    'video-remake': socialRatio,
    'product-ad-video': socialRatio,
    'listing-video': LISTING_FIRST_PLATFORMS.has(platform) ? '1:1' : socialRatio,
    'ugc-ad-video': '9:16',
    'image-to-video': socialRatio,
  };
}

export const PLATFORM_RULES = Object.fromEntries(PLATFORMS.map(platform => {
  const ratiosByApp = createRatios(platform);
  return [platform, {
    platform,
    defaultRatio: ratiosByApp['product-ad-video'],
    ratiosByApp,
    allowedRatios: ['9:16', '16:9', '4:3', '3:4', '1:1'],
    defaultDuration: SOCIAL_PLATFORMS.has(platform) ? 15 : 10,
    notes: [
      SOCIAL_PLATFORMS.has(platform) ? '内容化投放默认优先竖版视频。' : '商品展示默认优先方图/较稳妥比例。',
    ],
  }];
})) as Record<string, {
  platform: string;
  defaultRatio: string;
  ratiosByApp: AppRatioMap;
  allowedRatios: string[];
  defaultDuration: number;
  notes: string[];
}>;

export function getPlatformRule(platform: string) {
  const rule = PLATFORM_RULES[platform];
  if (!rule) {
    throw new CliError('ARGUMENT', `Invalid platform: ${platform}`, `Allowed platform values: ${Object.keys(PLATFORM_RULES).join(', ')}`);
  }
  return rule;
}

export function listPlatformRules() {
  return Object.values(PLATFORM_RULES);
}
