import { CliError } from '@jackwener/opencli/errors';
import { DEFAULT_IMAGE_MODEL } from './profiles.js';

const DEFAULT_ANGLES = ['Frontal', 'Lateral', 'Posterior'];

export const PLATFORM_RULES = {
  Amazon: {
    platform: 'Amazon',
    defaultRatio: '1:1',
    ratiosByKind: { main: '1:1', scene: '1:1', detail: '1:1', 'multi-angle': '1:1', model: '1:1' },
    allowedRatios: ['1:1', '4:5', '3:4', '4:3'],
    defaultResolution: '2K',
    defaultAngles: DEFAULT_ANGLES,
    defaultEngine: DEFAULT_IMAGE_MODEL,
    notes: ['主图优先方图；白底、主体占比高、无多余文字/水印更稳妥。'],
    sources: [{ label: 'Amazon product photo guidance', url: 'https://sell.amazon.com/blog/product-photos', confidence: 'official' }],
  },
  Temu: {
    platform: 'Temu',
    defaultRatio: '1:1',
    ratiosByKind: { main: '1:1', scene: '1:1', detail: '1:1', 'multi-angle': '1:1', model: '1:1' },
    allowedRatios: ['1:1', '4:5', '3:4'],
    defaultResolution: '2K',
    defaultAngles: DEFAULT_ANGLES,
    defaultEngine: DEFAULT_IMAGE_MODEL,
    notes: ['按跨境电商商品主图保守使用 1:1。'],
    sources: [{ label: 'Conservative ecommerce square-image profile', confidence: 'inferred' }],
  },
  TikTokShop: {
    platform: 'TikTokShop',
    defaultRatio: '1:1',
    ratiosByKind: { main: '1:1', scene: '1:1', detail: '1:1', 'multi-angle': '1:1', model: '1:1', social: '9:16', story: '9:16' },
    allowedRatios: ['1:1', '4:5', '9:16'],
    defaultResolution: '2K',
    defaultAngles: DEFAULT_ANGLES,
    defaultEngine: DEFAULT_IMAGE_MODEL,
    notes: ['商品图走 1:1；短视频/内容化素材走 9:16。'],
    sources: [{ label: 'TikTok Shop Seller University product listing guidance', url: 'https://seller-us.tiktok.com/university/essay?default_language=en&identity=1&knowledge_id=3196690250417921', confidence: 'official' }],
  },
  Shopee: {
    platform: 'Shopee',
    defaultRatio: '1:1',
    ratiosByKind: { main: '1:1', scene: '1:1', detail: '1:1', 'multi-angle': '1:1', model: '1:1' },
    allowedRatios: ['1:1', '4:5', '3:4'],
    defaultResolution: '2K',
    defaultAngles: DEFAULT_ANGLES,
    defaultEngine: DEFAULT_IMAGE_MODEL,
    notes: ['商品主图按 Shopee 常见方图规范处理。'],
    sources: [{ label: 'Shopee marketplace image requirements summary', url: 'https://support.channelengine.com/hc/en-us/articles/4409503364509-Shopee-marketplace-guide', confidence: 'third-party' }],
  },
  Lazada: {
    platform: 'Lazada',
    defaultRatio: '1:1',
    ratiosByKind: { main: '1:1', scene: '1:1', detail: '1:1', 'multi-angle': '1:1', model: '1:1' },
    allowedRatios: ['1:1', '4:5', '3:4'],
    defaultResolution: '2K',
    defaultAngles: DEFAULT_ANGLES,
    defaultEngine: DEFAULT_IMAGE_MODEL,
    notes: ['商品图按 Lazada 方图/高分辨率商品图处理。'],
    sources: [{ label: 'Lazada marketplace image requirements summary', url: 'https://support.channelengine.com/hc/en-us/articles/4409503569565-Lazada-marketplace-guide', confidence: 'third-party' }],
  },
  Hacoo: {
    platform: 'Hacoo',
    defaultRatio: '1:1',
    ratiosByKind: { main: '1:1', scene: '4:5', detail: '1:1', 'multi-angle': '1:1', model: '4:5', social: '4:5', story: '9:16' },
    allowedRatios: ['1:1', '4:5', '3:4', '9:16'],
    defaultResolution: '2K',
    defaultAngles: DEFAULT_ANGLES,
    defaultEngine: DEFAULT_IMAGE_MODEL,
    notes: ['按移动端社交电商保守配置。'],
    sources: [{ label: 'Conservative mobile social-commerce profile', confidence: 'inferred' }],
  },
  XiaoHongShu: {
    platform: 'XiaoHongShu',
    defaultRatio: '3:4',
    ratiosByKind: { main: '3:4', scene: '3:4', detail: '3:4', 'multi-angle': '3:4', model: '3:4', social: '3:4', story: '9:16' },
    allowedRatios: ['3:4', '1:1', '4:5', '9:16'],
    defaultResolution: '2K',
    defaultAngles: DEFAULT_ANGLES,
    defaultEngine: DEFAULT_IMAGE_MODEL,
    notes: ['笔记/封面优先竖图；商品化素材默认 3:4 以适配信息流。'],
    sources: [{ label: 'Common Xiaohongshu note-cover practice', confidence: 'inferred' }],
  },
  Instagram: {
    platform: 'Instagram',
    defaultRatio: '4:5',
    ratiosByKind: { main: '1:1', scene: '4:5', detail: '4:5', 'multi-angle': '4:5', model: '4:5', social: '4:5', story: '9:16' },
    allowedRatios: ['1:1', '4:5', '9:16', '16:9'],
    defaultResolution: '2K',
    defaultAngles: DEFAULT_ANGLES,
    defaultEngine: DEFAULT_IMAGE_MODEL,
    notes: ['Feed 优先 4:5，Story/Reels 走 9:16，商品卡片可用 1:1。'],
    sources: [{ label: 'Meta ads guide for Instagram placements', url: 'https://www.facebook.com/business/ads-guide/', confidence: 'official' }],
  },
  Etsy: {
    platform: 'Etsy',
    defaultRatio: '4:3',
    ratiosByKind: { main: '4:3', scene: '4:3', detail: '4:3', 'multi-angle': '4:3', model: '4:3', social: '1:1' },
    allowedRatios: ['4:3', '1:1', '3:4', '4:5'],
    defaultResolution: '2K',
    defaultAngles: DEFAULT_ANGLES,
    defaultEngine: DEFAULT_IMAGE_MODEL,
    notes: ['Listing 图优先高分辨率横图/方图；首图裁切时保留主体安全边距。'],
    sources: [{ label: 'Etsy listing image best practices', url: 'https://help.etsy.com/hc/en-us/articles/115015663347-How-to-Add-Listing-Photos', confidence: 'official' }],
  },
  Taobao: {
    platform: 'Taobao',
    defaultRatio: '1:1',
    ratiosByKind: { main: '1:1', scene: '3:4', detail: '3:4', 'multi-angle': '1:1', model: '3:4', social: '3:4' },
    allowedRatios: ['1:1', '3:4', '4:5'],
    defaultResolution: '2K',
    defaultAngles: DEFAULT_ANGLES,
    defaultEngine: DEFAULT_IMAGE_MODEL,
    notes: ['主图走 1:1；详情/模特展示按移动端长图习惯走 3:4。'],
    sources: [{ label: 'Common Taobao merchant image practice', confidence: 'inferred' }],
  },
  Pinduoduo: {
    platform: 'Pinduoduo',
    defaultRatio: '1:1',
    ratiosByKind: { main: '1:1', scene: '1:1', detail: '3:4', 'multi-angle': '1:1', model: '3:4', social: '1:1' },
    allowedRatios: ['1:1', '3:4', '4:5'],
    defaultResolution: '2K',
    defaultAngles: DEFAULT_ANGLES,
    defaultEngine: DEFAULT_IMAGE_MODEL,
    notes: ['主图走 1:1；详情/服饰模特图可走 3:4。'],
    sources: [{ label: 'Common Pinduoduo merchant image practice', confidence: 'inferred' }],
  },
} as const;

export function getPlatformRule(platform: string) {
  const rule = PLATFORM_RULES[platform as keyof typeof PLATFORM_RULES];
  if (!rule) {
    throw new CliError('ARGUMENT', `Invalid platform: ${platform}`, `Allowed platform values: ${Object.keys(PLATFORM_RULES).join(', ')}`);
  }
  return rule;
}

export function listPlatformRules() {
  return Object.values(PLATFORM_RULES);
}
