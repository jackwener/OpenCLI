import { CliError } from '@jackwener/opencli/errors';
import { addGenerateOptions, readJsonObjectInput } from './common.js';

type AppId =
  | 'try-on'
  | 'change-model'
  | 'mix-match'
  | 'change-action'
  | 'change-product'
  | 'change-background'
  | 'gen-main'
  | 'gen-scene'
  | 'gen-details'
  | 'details-selling-points'
  | 'add-selling-points'
  | 'gen-multi-angles'
  | 'gen-size-compare'
  | 'creative-image-generation'
  | 'pattern-extraction'
  | 'pattern-fission'
  | 'scene-fission'
  | '3d-from-2d'
  | 'product-modification'
  | 'change-color'
  | 'remove-background'
  | 'remove-watermark'
  | 'remove-face';

interface AppDefinition {
  app: AppId;
  title: string;
  imageKind: string;
  requiredFields: string[];
  keywords: string[];
  fields: string[];
}

export interface ImageAppPlan {
  intent: string;
  selectedApp: AppId;
  selectedTitle: string;
  confidence: number;
  imageKind: string;
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
  app('try-on', '单件模特穿搭', 'model', ['products'], ['一键穿搭', '穿搭', '试穿', '上身', 'try on', 'try-on'], ['products', 'person', 'market', 'category', 'count', 'ratio', 'resolution', 'prompt', 'engine']),
  app('change-model', '换模特', 'model', ['products'], ['换模特', '更换模特', '替换模特', 'change model'], ['products', 'person', 'market', 'count', 'ratio', 'resolution', 'prompt', 'engine']),
  app('mix-match', '多件融合模特穿搭', 'model', ['products'], ['多件', '融合穿搭', '搭配', '套装', 'mix match', 'mix-match'], ['products', 'person', 'market', 'ratio', 'resolution', 'prompt', 'engine']),
  app('change-action', '换动作', 'model', ['product'], ['换动作', '动作', '姿势', 'pose', 'action'], ['product', 'actions', 'ratio', 'resolution', 'prompt', 'engine']),
  app('change-product', '商品替换', 'scene', ['products'], ['换商品', '商品替换', '替换商品', 'change product', 'replace product'], ['products', 'scene', 'ratio', 'resolution', 'prompt', 'engine']),
  app('change-background', '换场景', 'scene', ['product'], ['换背景', '换场景', '背景替换', 'change background', 'change scene'], ['product', 'scene', 'ratio', 'resolution', 'prompt', 'engine']),
  app('gen-main', '商品主图', 'main', ['products'], ['主图', '商品主图', '电商主图', 'listing image', 'main image', 'hero image'], ['products', 'template', 'market', 'platform', 'category', 'count', 'ratio', 'resolution', 'prompt', 'engine']),
  app('gen-scene', '场景图', 'scene', ['products'], ['场景图', '场景化', '生活方式图', 'lifestyle', 'scene image'], ['products', 'market', 'platform', 'category', 'count', 'ratio', 'resolution', 'prompt', 'engine']),
  app('gen-details', '细节特写图', 'detail', ['product_and_attrs'], ['细节', '特写', '细节图', 'detail', 'macro'], ['product_and_attrs', 'market', 'platform', 'category', 'prompt', 'count', 'ratio', 'resolution', 'engine']),
  app('details-selling-points', '商品卖点图', 'detail', ['product_and_attrs'], ['卖点图', '卖点说明', 'selling point image', 'benefit image'], ['product_and_attrs', 'category', 'count', 'ratio', 'resolution', 'prompt', 'engine']),
  app('add-selling-points', '加卖点标注', 'detail', ['product_and_attrs'], ['加卖点', '卖点标注', '标注', 'annotation', 'label'], ['product_and_attrs', 'prompt', 'engine']),
  app('gen-multi-angles', '角度图', 'multi-angle', ['products', 'angles'], ['多角度', '角度图', '正面', '侧面', '背面', 'multi angle', 'multi-angle'], ['products', 'person', 'market', 'platform', 'category', 'angles', 'prompt', 'engine']),
  app('gen-size-compare', '尺码对比图', 'detail', ['product_and_size_chart'], ['尺码', '尺码对比', 'size chart', 'size compare'], ['product_and_size_chart', 'prompt', 'ratio', 'resolution', 'engine']),
  app('creative-image-generation', '创意素材', 'social', [], ['创意素材', '创意图', '海报', '广告图', 'poster', 'ad creative', 'social creative'], ['style', 'prompt', 'count', 'engine']),
  app('pattern-extraction', '图案提取', 'edit', ['product'], ['图案提取', '提取图案', 'pattern extraction', 'extract pattern'], ['product', 'prompt', 'background', 'engine']),
  app('pattern-fission', '图案裂变', 'edit', ['product'], ['图案裂变', '图案变体', 'pattern variant', 'pattern fission'], ['product', 'similarity', 'prompt', 'count', 'background', 'engine']),
  app('scene-fission', '场景裂变', 'scene', ['product'], ['场景裂变', '场景变体', 'scene variant', 'scene fission'], ['product', 'similarity', 'prompt', 'count', 'engine']),
  app('3d-from-2d', '服装 3D 图', 'edit', ['product'], ['3d', '3D', '三维', '立体', '2d to 3d'], ['product', 'prompt', 'engine']),
  app('product-modification', '款式裂变', 'edit', ['product'], ['款式裂变', '改款', '款式变体', 'style variant', 'product modification'], ['product', 'similarity', 'prompt', 'count', 'engine']),
  app('change-color', '换颜色', 'edit', ['product'], ['换颜色', '改色', '颜色替换', 'change color', 'recolor'], ['product', 'color_ref', 'prompt', 'ratio', 'resolution', 'engine']),
  app('remove-background', '白底/透明图', 'main', ['products'], ['去背景', '白底', '透明图', 'remove background', 'background removal'], ['products', 'prompt', 'background', 'engine']),
  app('remove-watermark', '去水印', 'edit', ['products'], ['去水印', '水印', 'remove watermark'], ['products', 'ratio', 'resolution', 'prompt', 'engine']),
  app('remove-face', '模糊人脸/去人脸', 'edit', ['products'], ['去人脸', '模糊人脸', '人脸', 'face blur', 'remove face'], ['products', 'prompt', 'engine']),
];

const PLATFORM_ALIASES: Record<string, string[]> = {
  Amazon: ['amazon', '亚马逊'],
  Temu: ['temu'],
  TikTokShop: ['tiktokshop', 'tiktok shop', 'tiktok', 'tik tok', '抖音', '抖店'],
  Shopee: ['shopee', '虾皮'],
  Lazada: ['lazada'],
  Hacoo: ['hacoo'],
  XiaoHongShu: ['xiaohongshu', '小红书', 'rednote', 'red book'],
  Instagram: ['instagram', 'ins'],
  Etsy: ['etsy'],
  Taobao: ['taobao', '淘宝', '天猫', 'tmall'],
  Pinduoduo: ['pinduoduo', '拼多多', 'pdd'],
};

const MARKET_ALIASES: Record<string, string[]> = {
  China: ['china', '中国', '国内'],
  Malaysia: ['malaysia', '马来西亚'],
  Korea: ['korea', '韩国'],
  'Southeast Asia': ['southeast asia', '东南亚'],
  'South America': ['south america', '南美'],
  Indonesia: ['indonesia', '印尼', '印度尼西亚'],
  Thailand: ['thailand', '泰国'],
  'Central Europe': ['central europe', '中欧'],
  'Western Europe': ['western europe', '西欧'],
  'Northern Europe': ['northern europe', '北欧'],
  'West Asia': ['west asia', '西亚'],
  'North America': ['north america', '北美', '美国', '加拿大'],
  Africa: ['africa', '非洲'],
  Japan: ['japan', '日本'],
  Russia: ['russia', '俄罗斯'],
};

const CATEGORY_ALIASES: Record<string, string[]> = {
  'Bags & Luggage': ['bags', 'luggage', '包', '箱包', '行李箱'],
  'Beauty & Personal Care': ['beauty', 'personal care', '美妆', '个护', '护肤'],
  "Children's Clothing": ['children clothing', 'kids clothing', '童装', '儿童服装'],
  'Home Decor': ['home decor', '家居装饰', '软装'],
  'Home Textiles': ['home textiles', '家纺', '床品'],
  "Men's Clothing": ['men clothing', 'mens clothing', '男装'],
  "Men's Shoes": ['men shoes', 'mens shoes', '男鞋'],
  "Women's Clothing": ['women clothing', 'womens clothing', '女装'],
  "Women's Shoes": ['women shoes', 'womens shoes', '女鞋'],
  Accessories: ['accessories', '配饰', '饰品'],
  Electronics: ['electronics', '电子', '数码', '3c', '手机', '耳机'],
  Toys: ['toys', '玩具'],
  'Furniture & Home Improvement': ['furniture', 'home improvement', '家具', '家装'],
  'Appliances & Digital': ['appliances', 'digital', '家电'],
  'Sports & Outdoors': ['sports', 'outdoors', '运动', '户外'],
  'Maternity & Trendy Toys': ['maternity', '母婴', '潮玩'],
  'Cleaning & Pets': ['cleaning', 'pets', '清洁', '宠物'],
  'Automotive & Travel': ['automotive', 'travel', '汽车', '旅行'],
  'Food & Fresh': ['food', 'fresh', '食品', '生鲜'],
  'Office & Stationery': ['office', 'stationery', '办公', '文具'],
  'Books & Flowers': ['books', 'flowers', '图书', '鲜花'],
  'Watches & Jewelry': ['watches', 'jewelry', '手表', '珠宝', '首饰'],
};

const ANGLE_ALIASES: Record<string, string[]> = {
  Frontal: ['frontal', '正面', '前面', 'front'],
  Lateral: ['lateral', '侧面', 'side'],
  Posterior: ['posterior', '背面', '后面', 'back'],
  'Three-Quarter': ['three-quarter', 'three quarter', '3/4', '45度', '四分之三', '斜侧'],
  'Top-Down': ['top-down', 'top down', '俯拍', '俯视'],
  'Macro Detail': ['macro detail', 'macro', '细节', '特写'],
};

export const RUN_EXTRA_ARGS = [
  { name: 'app', help: 'Override selected app id, e.g. gen-main' },
  { name: 'product', help: 'Product/original image URL' },
  { name: 'products', help: 'Comma-separated product image URLs' },
  { name: 'person', help: 'Reference model/person image URL' },
  { name: 'reference', help: 'Generic reference image URL, routed by selected app' },
  { name: 'scene', help: 'Scene/background reference image URL' },
  { name: 'template', help: 'Main-image template reference URL' },
  { name: 'style', help: 'Creative style reference image URL' },
  { name: 'color-ref', help: 'Color reference image URL' },
  { name: 'actions', help: 'Comma-separated action/pose reference image URLs' },
  { name: 'attrs', help: 'Comma-separated attribute/detail image URLs' },
  { name: 'size-chart', help: 'Size chart image URL' },
  { name: 'platform', help: 'Target platform, e.g. Amazon, Taobao, XiaoHongShu' },
  { name: 'market', help: 'Target country/region, e.g. China, North America' },
  { name: 'category', help: 'Product category' },
  { name: 'angles', help: 'Comma-separated angles, e.g. Frontal,Lateral' },
  { name: 'ratio', help: 'Aspect ratio, e.g. 1:1, 3:4, 9:16' },
  { name: 'resolution', help: 'Resolution, e.g. 1K, 2K, 4K' },
  { name: 'count', help: 'Image count' },
  { name: 'prompt', help: 'Extra generation prompt/requirements' },
  { name: 'engine', help: 'Image model id' },
  { name: 'background', help: 'Background option for edit apps' },
  { name: 'similarity', help: 'Similarity value for fission/modification apps' },
  { name: 'dry-run', help: 'Return selected app and generated workflow input without running workflow' },
];

export function buildImageAppPlan(positionals: string[], kwargs: Record<string, unknown>): ImageAppPlan {
  const intent = readIntent(positionals, kwargs);
  const input = buildInput(intent, kwargs);
  const selectedApp = selectApp(intent, input, kwargs);
  routeGenericImages(selectedApp.app, input, intent, kwargs);

  const candidates = scoreApps(intent, input);
  const selectedCandidate = candidates.find(candidate => candidate.app === selectedApp.app) ?? buildCandidate(selectedApp, input, 1, ['explicit app']);
  const missingFields = getMissingFields(selectedApp, input);
  const generateRequest = addGenerateOptions({ app: selectedApp.app, input }, kwargs);

  return {
    intent,
    selectedApp: selectedApp.app,
    selectedTitle: selectedApp.title,
    confidence: selectedCandidate.confidence,
    imageKind: selectedApp.imageKind,
    input,
    requiredFields: selectedApp.requiredFields,
    missingFields,
    candidates,
    shouldAskUser: selectedCandidate.confidence < readMinConfidence(kwargs) || missingFields.length > 0,
    generateRequest,
  };
}

export function assertRunnablePlan(plan: ImageAppPlan): void {
  if (plan.missingFields.length === 0) return;
  throw new CliError(
    'ARGUMENT',
    `Missing required fields for ${plan.selectedApp}: ${plan.missingFields.join(', ')}`,
    `Use --input JSON or image flags. Current planned input: ${JSON.stringify(plan.input)}`,
  );
}

function app(app: AppId, title: string, imageKind: string, requiredFields: string[], keywords: string[], fields: string[]): AppDefinition {
  return { app, title, imageKind, requiredFields, keywords, fields };
}

function readIntent(positionals: string[], kwargs: Record<string, unknown>): string {
  const explicit = firstString(kwargs.intent);
  return (explicit || positionals.filter(Boolean).join(' ')).trim();
}

function buildInput(intent: string, kwargs: Record<string, unknown>): Record<string, unknown> {
  const input = readJsonObjectInput(kwargs);
  applyScalar(input, 'platform', firstString(kwargs.platform) ?? matchAlias(intent, PLATFORM_ALIASES));
  applyScalar(input, 'market', firstString(kwargs.market) ?? matchAlias(intent, MARKET_ALIASES));
  applyScalar(input, 'category', firstString(kwargs.category) ?? matchAlias(intent, CATEGORY_ALIASES));
  applyScalar(input, 'ratio', firstString(kwargs.ratio) ?? inferRatio(intent));
  applyScalar(input, 'resolution', firstString(kwargs.resolution) ?? inferResolution(intent));
  applyScalar(input, 'count', parseNumber(firstString(kwargs.count) ?? inferCount(intent)));
  applyScalar(input, 'prompt', firstString(kwargs.prompt));
  applyScalar(input, 'engine', firstString(kwargs.engine));
  applyScalar(input, 'background', firstString(kwargs.background) ?? inferBackground(intent));
  applyScalar(input, 'similarity', parseNumber(firstString(kwargs.similarity)));

  const angles = splitList(firstString(kwargs.angles));
  const inferredAngles = inferAngles(intent);
  if (!hasValue(input.angles) && (angles.length > 0 || inferredAngles.length > 0)) {
    input.angles = angles.length > 0 ? angles : inferredAngles;
  }

  const products = splitList(firstString(kwargs.products));
  const product = firstString(kwargs.product);
  if (!hasValue(input.products) && products.length > 0) input.products = products;
  if (!hasValue(input.product) && product) input.product = product;
  applyScalar(input, 'person', firstString(kwargs.person));
  applyScalar(input, 'scene', firstString(kwargs.scene));
  applyScalar(input, 'template', firstString(kwargs.template));
  applyScalar(input, 'style', firstString(kwargs.style));
  applyScalar(input, 'color_ref', firstString(kwargs['color-ref']));

  const actions = splitList(firstString(kwargs.actions));
  if (!hasValue(input.actions) && actions.length > 0) input.actions = actions;

  return input;
}

function selectApp(intent: string, input: Record<string, unknown>, kwargs: Record<string, unknown>): AppDefinition {
  const explicit = firstString(kwargs.app, input.app);
  if (explicit) {
    const selected = APPS.find(item => item.app === explicit);
    if (!selected) {
      throw new CliError('ARGUMENT', `Unknown maybeai-image-app app: ${explicit}`, `Supported apps: ${APPS.map(item => item.app).join(', ')}`);
    }
    delete input.app;
    return selected;
  }
  return APPS.find(item => item.app === scoreApps(intent, input)[0]?.app) ?? APPS.find(item => item.app === 'gen-main')!;
}

function scoreApps(intent: string, input: Record<string, unknown>) {
  const normalized = normalize(intent);
  const scored = APPS.map(def => {
    let score = 0;
    const reasons: string[] = [];
    if (normalized.includes(def.app)) {
      score += 2;
      reasons.push(`intent contains app id ${def.app}`);
    }
    if (normalize(def.title) && normalized.includes(normalize(def.title))) {
      score += 1.2;
      reasons.push(`intent matches title ${def.title}`);
    }
    for (const keyword of def.keywords) {
      if (normalized.includes(normalize(keyword))) {
        score += 1;
        reasons.push(`keyword ${keyword}`);
      }
    }
    for (const field of Object.keys(input)) {
      if (def.fields.includes(field)) {
        score += fieldBoost(field, def.app);
        if (fieldBoost(field, def.app) > 0) reasons.push(`input field ${field}`);
      }
    }
    score += semanticBoost(def.app, normalized, input, reasons);
    return buildCandidate(def, input, score, reasons);
  }).filter(item => item.score > 0);

  const fallback = scored.length > 0 ? scored : [buildCandidate(APPS.find(item => item.app === 'gen-main')!, input, 0.01, ['fallback candidate'])];
  fallback.sort((a, b) => b.score - a.score);
  const topScore = Math.max(fallback[0]?.score ?? 1, 1);
  return fallback.slice(0, 5).map(item => ({ ...item, confidence: round(item.score / topScore) }));
}

function buildCandidate(def: AppDefinition, input: Record<string, unknown>, score: number, reasons: string[]) {
  return {
    app: def.app,
    title: def.title,
    score: round(score),
    confidence: 0,
    reasons,
    requiredFields: def.requiredFields,
    missingFields: getMissingFields(def, input),
  };
}

function routeGenericImages(appId: AppId, input: Record<string, unknown>, intent: string, kwargs: Record<string, unknown>): void {
  const urls = [
    ...extractUrls(intent),
    ...splitList(firstString(kwargs.reference)),
    ...splitList(firstString(kwargs.attrs)),
    ...splitList(firstString(kwargs['size-chart'])),
  ];
  if (urls.length === 0) return;

  if (requiresDataframe(appId)) {
    routeDataframeImages(appId, input, urls, kwargs);
    return;
  }

  ensurePrimaryImage(appId, input, urls[0]);
  const reference = firstString(kwargs.reference) ?? urls[1];
  if (!reference) return;

  if (['try-on', 'change-model', 'mix-match', 'gen-multi-angles'].includes(appId)) applyScalar(input, 'person', reference);
  else if (['change-product', 'change-background'].includes(appId)) applyScalar(input, 'scene', reference);
  else if (appId === 'change-action' && !hasValue(input.actions)) input.actions = [reference];
  else if (appId === 'gen-main') applyScalar(input, 'template', reference);
  else if (appId === 'creative-image-generation') applyScalar(input, 'style', reference);
  else if (appId === 'change-color') applyScalar(input, 'color_ref', reference);
}

function routeDataframeImages(appId: AppId, input: Record<string, unknown>, urls: string[], kwargs: Record<string, unknown>): void {
  const product = firstString(kwargs.product) ?? urls[0];
  const attrs = splitList(firstString(kwargs.attrs)).length > 0 ? splitList(firstString(kwargs.attrs)) : urls.slice(1);
  const sizeChart = firstString(kwargs['size-chart']) ?? urls[1];

  if (appId === 'gen-size-compare' && !hasValue(input.product_and_size_chart) && product && sizeChart) {
    input.product_and_size_chart = [{ product_image_url: product, reference_image_url: sizeChart }];
  } else if (!hasValue(input.product_and_attrs) && product) {
    input.product_and_attrs = [{ product_image_url: product, attr_image_urls: attrs }];
  }
}

function ensurePrimaryImage(appId: AppId, input: Record<string, unknown>, url: string | undefined): void {
  if (!url) return;
  if (usesProductList(appId)) {
    if (!hasValue(input.products)) input.products = [url];
  } else if (!hasValue(input.product)) {
    input.product = url;
  }
}

function getMissingFields(def: AppDefinition, input: Record<string, unknown>): string[] {
  return def.requiredFields.filter(field => !hasValue(input[field]));
}

function requiresDataframe(appId: AppId): boolean {
  return ['gen-details', 'details-selling-points', 'add-selling-points', 'gen-size-compare'].includes(appId);
}

function usesProductList(appId: AppId): boolean {
  return ['try-on', 'change-model', 'mix-match', 'change-product', 'gen-main', 'gen-scene', 'gen-multi-angles', 'remove-background', 'remove-watermark', 'remove-face'].includes(appId);
}

function fieldBoost(field: string, appId: AppId): number {
  if (field === 'person' && ['try-on', 'change-model', 'mix-match'].includes(appId)) return 0.25;
  if (field === 'actions' && appId === 'change-action') return 0.6;
  if (field === 'scene' && ['change-product', 'change-background'].includes(appId)) return 0.3;
  if (field === 'template' && appId === 'gen-main') return 0.25;
  if (field === 'product_and_attrs' && ['gen-details', 'details-selling-points', 'add-selling-points'].includes(appId)) return 0.4;
  if (field === 'angles' && appId === 'gen-multi-angles') return 0.8;
  if (field === 'product_and_size_chart' && appId === 'gen-size-compare') return 0.8;
  if (field === 'style' && appId === 'creative-image-generation') return 0.5;
  if (field === 'color_ref' && appId === 'change-color') return 0.7;
  if (['products', 'product'].includes(field)) return 0.05;
  return 0;
}

function semanticBoost(appId: AppId, intent: string, input: Record<string, unknown>, reasons: string[]): number {
  let boost = 0;
  const hasProduct = hasValue(input.products) || hasValue(input.product) || extractUrls(intent).length > 0;
  const hasPerson = hasValue(input.person);
  if (appId === 'gen-main' && hasProduct && hasAny(intent, ['amazon', 'temu', 'shopee', 'lazada', '淘宝', '平台', '电商'])) {
    boost += 0.35;
    reasons.push('product with ecommerce/platform intent');
  }
  if (appId === 'try-on' && hasProduct && (hasPerson || hasAny(intent, ['穿', '试', '搭']))) {
    boost += 0.45;
    reasons.push('product with try-on intent');
  }
  if (appId === 'change-model' && hasProduct && hasAny(intent, ['模特', 'model'])) {
    boost += 0.45;
    reasons.push('product with model intent');
  }
  if (appId === 'remove-background' && hasProduct && hasAny(intent, ['白底', '透明', '去背景'])) {
    boost += 0.5;
    reasons.push('product with background removal intent');
  }
  return boost;
}

function matchAlias(text: string, aliases: Record<string, string[]>): string | undefined {
  const normalized = normalize(text);
  for (const [value, names] of Object.entries(aliases)) {
    if (names.some(name => normalized.includes(normalize(name)))) return value;
  }
  return undefined;
}

function inferAngles(text: string): string[] {
  return Object.entries(ANGLE_ALIASES)
    .filter(([, aliases]) => aliases.some(alias => normalize(text).includes(normalize(alias))))
    .map(([angle]) => angle);
}

function inferRatio(text: string): string | undefined {
  const explicit = text.match(/(?:^|[^\d])(\d{1,2}\s*:\s*\d{1,2})(?:$|[^\d])/);
  if (explicit?.[1]) return explicit[1].replace(/\s+/g, '');
  if (hasAny(normalize(text), ['方图', '正方形', 'square'])) return '1:1';
  if (hasAny(normalize(text), ['竖图', 'portrait'])) return '3:4';
  if (hasAny(normalize(text), ['短视频', 'story', 'reels'])) return '9:16';
  return undefined;
}

function inferResolution(text: string): string | undefined {
  const match = text.match(/\b([124]k)\b/i);
  return match?.[1]?.toUpperCase();
}

function inferCount(text: string): string | undefined {
  const match = text.match(/(?:生成|出|做)?\s*(\d{1,2})\s*(?:张|个|幅|images?)/i);
  return match?.[1];
}

function inferBackground(text: string): string | undefined {
  if (hasAny(text, ['白底', 'white background'])) return 'white';
  if (hasAny(text, ['透明', 'transparent'])) return 'transparent';
  return undefined;
}

function extractUrls(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s"'，,]+/g)].map(match => match[0]);
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(/[,，\n]/).map(item => item.trim()).filter(Boolean);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function applyScalar(input: Record<string, unknown>, key: string, value: unknown): void {
  if (hasValue(input[key]) || value === undefined || value === null || value === '') return;
  input[key] = value;
}

function hasValue(value: unknown): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readMinConfidence(kwargs: Record<string, unknown>): number {
  const raw = firstString(kwargs['min-confidence']);
  if (!raw) return 0.3;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0.3;
}

function hasAny(text: string, words: string[]): boolean {
  const normalized = normalize(text);
  return words.some(word => normalized.includes(normalize(word)));
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
