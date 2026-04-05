import { ArgumentError, AuthRequiredError, CommandExecutionError } from '@jackwener/opencli/errors';
import type { IPage } from '@jackwener/opencli/types';

export const SITE = '1688';
export const HOME_URL = 'https://www.1688.com/';
export const SEARCH_URL_PREFIX = 'https://s.1688.com/selloffer/offer_search.htm?charset=utf8&keywords=';
export const DETAIL_URL_PREFIX = 'https://detail.1688.com/offer/';
export const STORE_MOBILE_URL_PREFIX = 'https://winport.m.1688.com/page/index.html?memberId=';
export const STRATEGY = 'cookie';
export const SEARCH_LIMIT_DEFAULT = 20;
export const SEARCH_LIMIT_MAX = 100;

const STORE_GENERIC_HOSTS = new Set(['www', 'detail', 's', 'winport', 'work', 'air', 'dj']);
const TRACKING_QUERY_KEYS = new Set([
  'spm',
  'tracelog',
  'clickid',
  'source',
  'scene',
  'from',
  'src',
  'ns',
  'cna',
  'pvid',
]);
const CAPTCHA_URL_MARKER = '/_____tmd_____/punish';
const CAPTCHA_TEXT_PATTERNS = [
  '请拖动下方滑块完成验证',
  '请按住滑块，拖动到最右边',
  '通过验证以确保正常访问',
  '验证码拦截',
  '访问验证',
  '滑动验证',
];
const LOGIN_TEXT_PATTERNS = [
  '请登录',
  '登录后',
  '账号登录',
  '手机登录',
  '立即登录',
  '扫码登录',
  '请先完成登录',
  '请先登录后查看',
];
const LOGIN_URL_PATTERNS = ['/member/login', 'passport', 'login.taobao.com', 'account.1688.com'];

export const FACTORY_BADGE_PATTERNS = [
  '源头工厂',
  '深度验厂',
  '实力工厂',
  '工厂档案',
  '加工专区',
  '验厂报告',
  '厂家直销',
  '生产厂家',
  '工厂直供',
];
export const SERVICE_BADGE_PATTERNS = [
  '延期必赔',
  '品质保障',
  '破损包赔',
  '退货包运费',
  '晚发必赔',
  '7*24小时响应',
  '48小时发货',
  '72小时发货',
  '后天达',
  '包邮',
  '闪电拿样',
];

const CHINA_LOCATIONS = [
  '北京',
  '天津',
  '上海',
  '重庆',
  '河北',
  '山西',
  '辽宁',
  '吉林',
  '黑龙江',
  '江苏',
  '浙江',
  '安徽',
  '福建',
  '江西',
  '山东',
  '河南',
  '湖北',
  '湖南',
  '广东',
  '海南',
  '四川',
  '贵州',
  '云南',
  '陕西',
  '甘肃',
  '青海',
  '台湾',
  '内蒙古',
  '广西',
  '西藏',
  '宁夏',
  '新疆',
  '香港',
  '澳门',
];

export interface ProvenanceFields {
  source_url: string;
  fetched_at: string;
  strategy: string;
}

export interface PageState {
  href: string;
  title: string;
  body_text: string;
}

export interface PriceRange {
  price_text: string;
  price_min: number | null;
  price_max: number | null;
  currency: string | null;
}

export interface MoqValue {
  moq_text: string;
  moq_value: number | null;
}

export interface PriceTier {
  quantity_text: string;
  quantity_min: number | null;
  price_text: string;
  price: number | null;
  currency: string | null;
}

export interface SearchCandidate {
  item_url: string;
  title: string;
  container_text: string;
  seller_name: string | null;
  seller_url: string | null;
}

export function cleanText(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
}

export function cleanMultilineText(value: unknown): string {
  return typeof value === 'string'
    ? value
      .replace(/\u00a0/g, ' ')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n')
    : '';
}

export function uniqueNonEmpty(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => cleanText(value)).filter(Boolean))];
}

export function parseSearchLimit(input: unknown): number {
  const parsed = Number.parseInt(String(input ?? SEARCH_LIMIT_DEFAULT), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new ArgumentError(
      '1688 search --limit must be a positive integer',
      'Example: opencli 1688 search "桌面置物架" --limit 20',
    );
  }
  return Math.min(SEARCH_LIMIT_MAX, parsed);
}

export function buildSearchUrl(query: string): string {
  const normalized = cleanText(query);
  if (!normalized) {
    throw new ArgumentError(
      '1688 search query cannot be empty',
      'Example: opencli 1688 search "桌面置物架" --limit 20',
    );
  }
  return `${SEARCH_URL_PREFIX}${encodeURIComponent(normalized)}`;
}

export function buildDetailUrl(input: string): string {
  const offerId = extractOfferId(input);
  if (!offerId) {
    throw new ArgumentError(
      '1688 item expects an offer URL or offer ID',
      'Example: opencli 1688 item 887904326744',
    );
  }
  return `${DETAIL_URL_PREFIX}${offerId}.html`;
}

export function resolveStoreUrl(input: string): string {
  const normalized = cleanText(input);
  if (!normalized) {
    throw new ArgumentError(
      '1688 store expects a store URL or member ID',
      'Example: opencli 1688 store https://yinuoweierfushi.1688.com/',
    );
  }

  const memberId = extractMemberId(normalized);
  if (memberId) {
    return `${STORE_MOBILE_URL_PREFIX}${memberId}`;
  }

  if (/^https?:\/\//i.test(normalized)) {
    return canonicalizeStoreUrl(normalized);
  }

  if (normalized.endsWith('.1688.com')) {
    return canonicalizeStoreUrl(`https://${normalized}`);
  }

  if (/^[a-z0-9-]+$/i.test(normalized)) {
    return canonicalizeStoreUrl(`https://${normalized}.1688.com`);
  }

  throw new ArgumentError(
    '1688 store expects a store URL or member ID',
    'Example: opencli 1688 store b2b-22154705262941f196',
  );
}

export function canonicalizeStoreUrl(input: string): string {
  const url = parse1688Url(input);
  const memberId = extractMemberId(url.toString());
  if (memberId) {
    return `${STORE_MOBILE_URL_PREFIX}${memberId}`;
  }

  const host = normalizeStoreHost(url.hostname);
  if (!host) {
    throw new ArgumentError(
      'Invalid 1688 store URL',
      'Example: opencli 1688 store https://yinuoweierfushi.1688.com/',
    );
  }
  return `https://${host}`;
}

export function canonicalizeItemUrl(input: string): string | null {
  const offerId = extractOfferId(input);
  if (offerId) {
    return `${DETAIL_URL_PREFIX}${offerId}.html`;
  }
  const url = parse1688UrlOrNull(input);
  if (!url) return null;
  stripTrackingParams(url);
  url.hash = '';
  return url.toString();
}

export function canonicalizeSellerUrl(input: string): string | null {
  const memberId = extractMemberId(input);
  if (memberId) {
    return `${STORE_MOBILE_URL_PREFIX}${memberId}`;
  }
  const url = parse1688UrlOrNull(input);
  if (!url) return null;
  const host = normalizeStoreHost(url.hostname);
  if (!host) return null;
  return `https://${host}`;
}

export function extractOfferId(input: string): string | null {
  const normalized = cleanText(input);
  if (!normalized) return null;
  const directId = normalized.match(/^\d{6,}$/)?.[0];
  if (directId) return directId;
  const detailMatch = normalized.match(/\/offer\/(\d{6,})\.html/i);
  if (detailMatch) return detailMatch[1];
  const queryMatch = normalized.match(/[?&]offerId=(\d{6,})/i);
  if (queryMatch) return queryMatch[1];
  return null;
}

export function extractMemberId(input: string): string | null {
  const normalized = cleanText(input);
  if (!normalized) return null;
  const direct = normalized.match(/\bb2b-[a-z0-9]+\b/i)?.[0];
  if (direct) return direct;
  const queryMatch = normalized.match(/[?&]memberId=(b2b-[a-z0-9]+)/i);
  if (queryMatch) return queryMatch[1];
  const mobileMatch = normalized.match(/\/winport\/(b2b-[a-z0-9]+)\.html/i);
  if (mobileMatch) return mobileMatch[1];
  return null;
}

export function extractShopId(input: string): string | null {
  const normalized = cleanText(input);
  if (!normalized) return null;

  try {
    const url = new URL(/^https?:\/\//i.test(normalized) ? normalized : `https://${normalized}`);
    const host = normalizeStoreHost(url.hostname);
    if (!host) return null;
    return host.split('.')[0] ?? null;
  } catch {
    return /^[a-z0-9-]+$/i.test(normalized) ? normalized : null;
  }
}

export function buildProvenance(sourceUrl: string): ProvenanceFields {
  return {
    source_url: sourceUrl,
    fetched_at: new Date().toISOString(),
    strategy: STRATEGY,
  };
}

export function parsePriceText(text: string): PriceRange {
  const normalized = normalizeNumericText(cleanText(text));
  const matches = normalized.match(/\d+(?:,\d{3})*(?:\.\d+)?/g) ?? [];
  const values = matches
    .map((value) => Number.parseFloat(value.replace(/,/g, '')))
    .filter((value) => Number.isFinite(value));

  if (values.length === 0) {
    return {
      price_text: normalized,
      price_min: null,
      price_max: null,
      currency: null,
    };
  }

  return {
    price_text: normalized,
    price_min: values[0] ?? null,
    price_max: values[values.length - 1] ?? values[0] ?? null,
    currency: normalized.includes('¥') || normalized.includes('元') ? 'CNY' : null,
  };
}

export function normalizePriceTiers(
  rawTiers: Array<{ beginAmount?: unknown; price?: unknown }>,
  unit: string | null,
): PriceTier[] {
  return rawTiers
    .map((tier) => {
      const quantityMin = toNumber(tier.beginAmount);
      const priceText = cleanText(tier.price);
      const price = toNumber(tier.price);
      return {
        quantity_text: quantityMin !== null ? `${quantityMin}${unit ?? ''}` : '',
        quantity_min: quantityMin,
        price_text: priceText,
        price,
        currency: priceText ? 'CNY' : null,
      };
    })
    .filter((tier) => tier.price_text);
}

export function parseMoqText(text: string): MoqValue {
  const normalized = normalizeNumericText(cleanText(text));
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*(件|个|套|箱|包|双|台|把|只|pcs|piece|pieces)?\s*起批/i)
    ?? normalized.match(/≥\s*(\d+(?:\.\d+)?)/);
  const rangeMatch = normalized.match(
    /(\d+(?:\.\d+)?)\s*(?:~|-|至|到)\s*\d+(?:\.\d+)?\s*(件|个|套|箱|包|双|台|把|只|pcs|piece|pieces)/i,
  );

  if (!match && !rangeMatch) {
    return {
      moq_text: normalized,
      moq_value: null,
    };
  }

  return {
    moq_text: normalized,
    moq_value: Number.parseFloat((match ?? rangeMatch)![1]),
  };
}

export function extractLocation(text: string): string | null {
  const normalized = cleanMultilineText(text);
  const primaryRegion = normalized.split(/送至|发往/)[0] ?? normalized;
  const lines = primaryRegion.split('\n');
  for (const line of lines) {
    const compact = cleanText(line);
    if (!compact || compact.length > 16) continue;
    if (CHINA_LOCATIONS.some((location) => compact.startsWith(location))) {
      return compact;
    }
  }

  const locationPattern = new RegExp(`(${CHINA_LOCATIONS.join('|')})[\\u4e00-\\u9fa5]{0,8}`);
  return primaryRegion.match(locationPattern)?.[0] ?? null;
}

export function extractAddress(text: string): string | null {
  const normalized = cleanMultilineText(text);
  const lineMatch = normalized.match(/地址[:：]\s*([^\n]+)/);
  if (lineMatch) return cleanText(lineMatch[1]);
  return normalized
    .split('\n')
    .map((line) => cleanText(line))
    .find((line) => line.includes('省') || line.includes('市') || line.includes('区') || line.includes('县'))
    ?? null;
}

export function extractMetric(text: string, label: string): string | null {
  const normalized = cleanMultilineText(text);
  const direct = normalized.match(new RegExp(`(?:^|\\n)\\s*${escapeForRegex(label)}[:：]?\\s*([^\\n]+)`));
  if (direct) return cleanText(direct[1]);

  const lineBased = normalized.match(new RegExp(`(?:^|\\n)\\s*${escapeForRegex(label)}\\n([^\\n]+)`));
  return lineBased ? cleanText(lineBased[1]) : null;
}

export function extractYearsOnPlatform(text: string): string | null {
  return text.match(/入驻\d+年/)?.[0] ?? null;
}

export function extractMainBusiness(text: string): string | null {
  const value = extractMetric(text, '主营');
  return value ? value.replace(/^：/, '').trim() : null;
}

export function extractBadges(text: string, candidates: string[]): string[] {
  return uniqueNonEmpty(candidates.filter((candidate) => cleanMultilineText(text).includes(candidate)));
}

export function guessTopCategories(text: string): string[] {
  const mainBusiness = extractMainBusiness(text);
  if (!mainBusiness) return [];
  return uniqueNonEmpty(mainBusiness.split(/[、,/|]/).map((value) => value.trim()));
}

export function isCaptchaState(state: Partial<PageState>): boolean {
  const href = cleanText(state.href).toLowerCase();
  const title = cleanText(state.title);
  const bodyText = cleanMultilineText(state.body_text);
  if (href.includes(CAPTCHA_URL_MARKER)) return true;
  return CAPTCHA_TEXT_PATTERNS.some((pattern) => title.includes(pattern) || bodyText.includes(pattern));
}

export function isLoginState(state: Partial<PageState>): boolean {
  const href = cleanText(state.href).toLowerCase();
  const title = cleanText(state.title);
  const bodyText = cleanMultilineText(state.body_text);
  if (LOGIN_URL_PATTERNS.some((pattern) => href.includes(pattern))) return true;
  return LOGIN_TEXT_PATTERNS.some((pattern) => title.includes(pattern) || bodyText.includes(pattern));
}

export function buildCaptchaHint(action: string): string {
  return [
    `Open a clean 1688 ${action} page in the shared Chrome profile and finish any slider challenge first.`,
    'If you run opencli via CDP, set OPENCLI_CDP_TARGET=1688.com or a more specific 1688 host before retrying.',
  ].join(' ');
}

export async function readPageState(page: IPage): Promise<PageState> {
  const result = await page.evaluate(`
    (() => ({
      href: window.location.href,
      title: document.title || '',
      body_text: document.body ? document.body.innerText || '' : '',
    }))()
  `) as Partial<PageState>;

  return {
    href: cleanText(result.href),
    title: cleanText(result.title),
    body_text: cleanMultilineText(result.body_text),
  };
}

export async function gotoAndReadState(
  page: IPage,
  url: string,
  settleMs: number = 2500,
  action: string = 'page',
): Promise<PageState> {
  try {
    await page.goto(url, { settleMs });
    await page.wait(1.5);
    return readPageState(page);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes('Inspected target navigated or closed')
      || message.includes('Cannot find context with specified id')
      || message.includes('Target closed')
    ) {
      throw new CommandExecutionError(
        `1688 ${action} navigation lost the current browser target`,
        `${buildCaptchaHint(action)} If CDP is attached to a stale or blocked tab, open a fresh 1688 tab and point OPENCLI_CDP_TARGET at that tab.`,
      );
    }
    throw error;
  }
}

export async function ensure1688Session(page: IPage): Promise<void> {
  const state = await gotoAndReadState(page, HOME_URL, 1500, 'homepage');
  assertAuthenticatedState(state, 'homepage');
}

export function assertAuthenticatedState(state: PageState, action: string): void {
  if (!isCaptchaState(state) && !isLoginState(state)) return;
  throw new AuthRequiredError('1688.com', `请先在共享 Chrome 完成 1688 登录/验证，再重试（${action}）`);
}

export function assertNotCaptcha(state: PageState, action: string): void {
  assertAuthenticatedState(state, action);
}

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.replace(/,/g, '').trim();
    if (!normalized) return null;
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function limitCandidates<T>(values: T[], limit: number): T[] {
  const normalizedLimit = Math.max(1, Math.trunc(limit) || 1);
  return values.slice(0, normalizedLimit);
}

function normalizeNumericText(value: string): string {
  return value
    .replace(/([¥$€])\s+(?=\d)/g, '$1')
    .replace(/(\d)\s*\.\s*(\d)/g, '$1.$2')
    .replace(/\s*([~-])\s*/g, '$1')
    .trim();
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parse1688Url(input: string): URL {
  const normalized = cleanText(input);
  try {
    const url = new URL(normalized);
    if (!url.hostname.endsWith('.1688.com') && url.hostname !== '1688.com' && url.hostname !== 'www.1688.com') {
      throw new Error('invalid-host');
    }
    stripTrackingParams(url);
    url.hash = '';
    return url;
  } catch {
    throw new ArgumentError(
      'Invalid 1688 URL',
      'Use a URL under 1688.com (for example: https://detail.1688.com/offer/887904326744.html)',
    );
  }
}

function parse1688UrlOrNull(input: string): URL | null {
  try {
    return parse1688Url(input);
  } catch {
    return null;
  }
}

function normalizeStoreHost(hostname: string): string | null {
  const lower = cleanText(hostname).toLowerCase();
  if (!lower.endsWith('.1688.com')) return null;
  const [subdomain] = lower.split('.');
  if (!subdomain || STORE_GENERIC_HOSTS.has(subdomain)) return null;
  return lower;
}

function stripTrackingParams(url: URL): void {
  const keys = [...url.searchParams.keys()];
  for (const key of keys) {
    if (TRACKING_QUERY_KEYS.has(key) || key.toLowerCase().startsWith('utm_')) {
      url.searchParams.delete(key);
    }
  }
}

export const __test__ = {
  SEARCH_LIMIT_DEFAULT,
  SEARCH_LIMIT_MAX,
  parseSearchLimit,
  buildSearchUrl,
  buildDetailUrl,
  resolveStoreUrl,
  canonicalizeStoreUrl,
  canonicalizeItemUrl,
  canonicalizeSellerUrl,
  extractOfferId,
  extractMemberId,
  extractShopId,
  parsePriceText,
  normalizePriceTiers,
  parseMoqText,
  extractLocation,
  extractAddress,
  extractMetric,
  extractYearsOnPlatform,
  extractMainBusiness,
  extractBadges,
  guessTopCategories,
  isCaptchaState,
  isLoginState,
  cleanText,
  cleanMultilineText,
  uniqueNonEmpty,
  limitCandidates,
};
