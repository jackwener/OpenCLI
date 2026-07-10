import { CliError } from '@jackwener/opencli/errors';
import { addGenerateOptions, firstString, readJsonObjectInput } from '../maybeai/shared/options.js';

type AppId = 'video-remake' | 'product-ad-video' | 'listing-video' | 'ugc-ad-video' | 'image-to-video';

interface AppDefinition {
  app: AppId;
  title: string;
  requiredFields: string[];
  keywords: string[];
}

export interface VideoAppPlan {
  intent: string;
  selectedApp: AppId;
  selectedTitle: string;
  confidence: number;
  input: Record<string, unknown>;
  requiredFields: string[];
  missingFields: string[];
  candidates: Array<{
    app: AppId;
    title: string;
    score: number;
    confidence: number;
    reasons: string[];
    requiredFields: string[];
    missingFields: string[];
  }>;
  shouldAskUser: boolean;
  generateRequest: Record<string, unknown>;
}

const APPS: AppDefinition[] = [
  app('video-remake', '视频翻拍', ['reference_video', 'product'], ['视频翻拍', '翻拍', '复刻', '参考视频', 'remake', 'replicate video', 'copy video']),
  app('product-ad-video', '一键商品视频', ['product'], ['一键生视频', '商品视频', '广告视频', 'product video', 'ad video']),
  app('listing-video', '商品详情视频', ['product'], ['listing', '详情视频', '详情页视频', '卖点视频']),
  app('ugc-ad-video', 'UGC 种草视频', ['product'], ['ugc', '种草', '口播', '达人', '测评']),
  app('image-to-video', '图生视频', ['image', 'prompt'], ['图生视频', '让这张图动起来', '动起来', 'image to video']),
];

const PLATFORM_ALIASES: Record<string, string[]> = {
  Amazon: ['amazon', '亚马逊'],
  TikTokShop: ['tiktokshop', 'tiktok shop', 'tiktok', '抖店', '抖音'],
  XiaoHongShu: ['xiaohongshu', '小红书'],
  Instagram: ['instagram', 'ins'],
  Taobao: ['taobao', '淘宝', '天猫'],
  Pinduoduo: ['pinduoduo', '拼多多', 'pdd'],
};

const MARKET_ALIASES: Record<string, string[]> = {
  China: ['china', '中国', '国内'],
  'North America': ['north america', '北美', '美国', '加拿大'],
  'Southeast Asia': ['southeast asia', '东南亚'],
  Japan: ['japan', '日本'],
};

const CATEGORY_ALIASES: Record<string, string[]> = {
  Electronics: ['electronics', '电子', '数码', '3c', '耳机', '手机'],
  "Women's Clothing": ['women clothing', '女装'],
  "Men's Clothing": ['men clothing', '男装'],
  'Beauty & Personal Care': ['beauty', '美妆', '个护'],
  'Sports & Outdoors': ['sports', '运动', '户外'],
};

export const RUN_EXTRA_ARGS = [
  { name: 'app', help: 'Override selected app id, e.g. product-ad-video' },
  { name: 'product', help: 'Primary product image URL' },
  { name: 'product-images', help: 'Comma-separated product image URLs; first image is used as canonical product input' },
  { name: 'person', help: 'Reference model/person image URL' },
  { name: 'reference-images', help: 'Comma-separated reference image URLs; first image is used as canonical person input' },
  { name: 'reference-video', help: 'Reference video URL for video-remake' },
  { name: 'image', help: 'Input image URL for image-to-video' },
  { name: 'platform', help: 'Target platform, e.g. TikTokShop, Amazon, XiaoHongShu' },
  { name: 'market', help: 'Target market, e.g. China, North America' },
  { name: 'category', help: 'Product category' },
  { name: 'style', help: 'Video style/template, e.g. ugc, listing, product-demo' },
  { name: 'ratio', help: 'Aspect ratio, e.g. 9:16, 1:1, 16:9' },
  { name: 'duration', help: 'Total duration in seconds' },
  { name: 'prompt', help: 'Extra video requirements' },
  { name: 'engine', help: 'Video model id' },
  { name: 'dry-run', help: 'Return selected app and generated workflow input without running workflow' },
];

export function buildVideoAppPlan(positionals: string[], kwargs: Record<string, unknown>): VideoAppPlan {
  const intent = readIntent(positionals, kwargs);
  const input = buildInput(intent, kwargs);
  const selectedApp = selectApp(intent, input, kwargs);
  const candidates = scoreApps(intent, input);
  const selectedCandidate = candidates.find(candidate => candidate.app === selectedApp.app) ?? buildCandidate(selectedApp, input, 1, ['explicit app']);
  const missingFields = getMissingFields(selectedApp, input);
  const generateRequest = addGenerateOptions({ app: selectedApp.app, input }, kwargs);

  return {
    intent,
    selectedApp: selectedApp.app,
    selectedTitle: selectedApp.title,
    confidence: selectedCandidate.confidence,
    input,
    requiredFields: selectedApp.requiredFields,
    missingFields,
    candidates,
    shouldAskUser: selectedCandidate.confidence < readMinConfidence(kwargs) || missingFields.length > 0,
    generateRequest,
  };
}

export function assertRunnablePlan(plan: VideoAppPlan): void {
  if (plan.missingFields.length === 0) return;
  throw new CliError(
    'ARGUMENT',
    `Missing required fields for ${plan.selectedApp}: ${plan.missingFields.join(', ')}`,
    `Use --input JSON or image flags. Current planned input: ${JSON.stringify(plan.input)}`,
  );
}

function app(appId: AppId, title: string, requiredFields: string[], keywords: string[]): AppDefinition {
  return { app: appId, title, requiredFields, keywords };
}

function readIntent(positionals: string[], kwargs: Record<string, unknown>): string {
  const explicit = firstString(kwargs.intent);
  return (explicit || positionals.filter(Boolean).join(' ')).trim();
}

function buildInput(intent: string, kwargs: Record<string, unknown>): Record<string, unknown> {
  const input = readJsonObjectInput(kwargs);
  const urls = extractUrls(intent);
  const explicitProduct = firstString(kwargs.product);
  const explicitImage = firstString(kwargs.image);
  const explicitPerson = firstString(kwargs.person);
  const explicitReferenceVideo = firstString(kwargs['reference-video']);

  applyScalar(input, 'platform', firstString(kwargs.platform) ?? matchAlias(intent, PLATFORM_ALIASES));
  applyScalar(input, 'market', firstString(kwargs.market) ?? matchAlias(intent, MARKET_ALIASES));
  applyScalar(input, 'category', firstString(kwargs.category) ?? matchAlias(intent, CATEGORY_ALIASES));
  applyScalar(input, 'style', firstString(kwargs.style) ?? inferStyle(intent));
  applyScalar(input, 'ratio', firstString(kwargs.ratio) ?? inferRatio(intent));
  applyScalar(input, 'duration', parseNumber(firstString(kwargs.duration) ?? inferDuration(intent)));
  applyScalar(input, 'prompt', firstString(kwargs.prompt));
  applyScalar(input, 'engine', firstString(kwargs.engine));

  const productImages = splitList(firstString(kwargs['product-images']));
  const referenceImages = splitList(firstString(kwargs['reference-images']));
  const nonVideoUrls = urls.filter(url => !isVideoUrl(url));

  if (!hasValue(input.product)) input.product = explicitProduct ?? productImages[0] ?? (isImageToVideoIntent(intent) ? undefined : urls[0]);
  if (!hasValue(input.person)) input.person = explicitPerson ?? referenceImages[0] ?? (nonVideoUrls.length > 1 && !isImageToVideoIntent(intent) ? nonVideoUrls[1] : undefined);
  if (!hasValue(input.reference_video)) input.reference_video = explicitReferenceVideo ?? (isRemakeIntent(intent) ? inferReferenceVideoUrl(urls, input.product, input.person) : undefined);
  if (!hasValue(input.image)) input.image = explicitImage ?? (isImageToVideoIntent(intent) ? urls[0] : undefined);

  removeEmptyValues(input);
  return input;
}

function selectApp(intent: string, input: Record<string, unknown>, kwargs: Record<string, unknown>) {
  const explicit = firstString(kwargs.app);
  if (explicit) {
    const match = APPS.find(item => item.app === explicit);
    if (!match) throw new CliError('ARGUMENT', `Unknown maybeai-video-app app: ${explicit}`, `Supported apps: ${APPS.map(item => item.app).join(', ')}`);
    return match;
  }
  if (isRemakeIntent(intent) || hasValue(input.reference_video)) return APPS.find(item => item.app === 'video-remake')!;
  if (isImageToVideoIntent(intent) || (hasValue(input.image) && !hasValue(input.product))) return APPS.find(item => item.app === 'image-to-video')!;
  if (matchesAny(intent, ['ugc', '种草', '口播', '达人', '测评'])) return APPS.find(item => item.app === 'ugc-ad-video')!;
  if (matchesAny(intent, ['listing', '详情', '卖点'])) return APPS.find(item => item.app === 'listing-video')!;
  return APPS.find(item => item.app === 'product-ad-video')!;
}

function scoreApps(intent: string, input: Record<string, unknown>) {
  return APPS
    .map(item => {
      let score = 0.1;
      const reasons: string[] = [];
      if (isImageToVideoIntent(intent) && item.app === 'image-to-video') {
        score += 0.8;
        reasons.push('image-to-video intent');
      }
      if (isRemakeIntent(intent) && item.app === 'video-remake') {
        score += 0.8;
        reasons.push('video remake intent');
      }
      const matchedKeywords = item.keywords.filter(keyword => intent.toLowerCase().includes(keyword.toLowerCase()));
      if (matchedKeywords.length > 0) {
        score += Math.min(0.6, matchedKeywords.length * 0.2);
        reasons.push(`matched keywords: ${matchedKeywords.join(', ')}`);
      }
      const missingFields = getMissingFields(item, input);
      if (missingFields.length === 0) {
        score += 0.2;
        reasons.push('all required inputs present');
      }
      return buildCandidate(item, input, Math.min(1, score), reasons);
    })
    .sort((left, right) => right.score - left.score);
}

function buildCandidate(appDef: AppDefinition, input: Record<string, unknown>, score: number, reasons: string[]) {
  const missingFields = getMissingFields(appDef, input);
  return {
    app: appDef.app,
    title: appDef.title,
    score,
    confidence: Number(score.toFixed(2)),
    reasons,
    requiredFields: appDef.requiredFields,
    missingFields,
  };
}

function getMissingFields(appDef: AppDefinition, input: Record<string, unknown>) {
  return appDef.requiredFields.filter(field => !hasValue(input[field]));
}

function readMinConfidence(kwargs: Record<string, unknown>) {
  const raw = typeof kwargs['min-confidence'] === 'string' ? Number(kwargs['min-confidence']) : undefined;
  return Number.isFinite(raw) ? raw! : 0.3;
}

function extractUrls(intent: string) {
  return Array.from(intent.matchAll(/https?:\/\/\S+/g)).map(match => match[0].replace(/[),.]+$/g, ''));
}

function inferRatio(intent: string) {
  return ['9:16', '1:1', '16:9', '4:3', '3:4'].find(ratio => intent.includes(ratio));
}

function inferDuration(intent: string) {
  const match = intent.match(/(\d+)\s*秒/);
  return match?.[1];
}

function inferStyle(intent: string) {
  if (matchesAny(intent, ['ugc', '种草', '口播'])) return 'ugc';
  if (matchesAny(intent, ['listing', '详情', '卖点'])) return 'listing';
  if (matchesAny(intent, ['lifestyle', '场景', '生活方式'])) return 'lifestyle';
  return undefined;
}

function matchAlias(intent: string, aliases: Record<string, string[]>) {
  const normalized = intent.toLowerCase();
  for (const [value, patterns] of Object.entries(aliases)) {
    if (patterns.some(pattern => normalized.includes(pattern.toLowerCase()))) return value;
  }
  return undefined;
}

function isImageToVideoIntent(intent: string) {
  return matchesAny(intent, ['图生视频', '让这张图动起来', '动起来', 'image to video']);
}

function isRemakeIntent(intent: string) {
  return matchesAny(intent, ['视频翻拍', '翻拍', '复刻', '参考视频', 'remake', 'replicate video', 'copy video']);
}

function inferReferenceVideoUrl(urls: string[], product: unknown, person: unknown) {
  const productUrl = typeof product === 'string' ? product : undefined;
  const personUrl = typeof person === 'string' ? person : undefined;
  return urls.find(url => url !== productUrl && url !== personUrl && isVideoUrl(url)) ?? urls[2] ?? urls[1];
}

function matchesAny(intent: string, patterns: string[]) {
  const normalized = intent.toLowerCase();
  return patterns.some(pattern => normalized.includes(pattern.toLowerCase()));
}

function isVideoUrl(url: string) {
  return /\.(mp4|mov|webm)(\?|#|$)/i.test(url);
}

function applyScalar(input: Record<string, unknown>, key: string, value: unknown) {
  if (!hasValue(input[key]) && hasValue(value)) input[key] = value;
}

function parseNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function splitList(value: string | undefined) {
  if (!value) return [];
  return value.split(',').map(item => item.trim()).filter(Boolean);
}

function hasValue(value: unknown) {
  return !(value === undefined || value === null || value === '');
}

function removeEmptyValues(input: Record<string, unknown>) {
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === '') delete input[key];
  }
}
